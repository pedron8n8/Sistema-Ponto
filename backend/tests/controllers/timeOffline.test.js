// Batida offline: o horário gravado tem que ser o horário em que a pessoa bateu
// o ponto, não o horário em que o celular reencontrou sinal. workedMinutes,
// hora extra 50/100 e banco de horas saem todos de clockOut - clockIn, então
// gravar a hora da sincronização corrompe a folha de pagamento.

const mockPrisma = require('../mocks/prisma.mock');
const { captureRequestMetadata } = require('../../src/utils/requestMetadata');
const { evaluateGeofence } = require('../../src/utils/geofence');
const { verifyPin } = require('../../src/utils/pinAuth');
const { accrueBankHours } = require('../../src/utils/bankHours');

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/utils/requestMetadata', () => ({
  captureRequestMetadata: jest.fn(),
}));
jest.mock('../../src/utils/geofence', () => ({
  evaluateGeofence: jest.fn(),
  getGeofencePublicConfig: jest.fn(),
  getGeofenceConfig: jest.fn(),
  LOCATION_VALIDATION_SOURCES: { GPS: 'GPS', TERMINAL_QR: 'TERMINAL_QR' },
}));
jest.mock('../../src/utils/pinAuth', () => ({
  verifyPin: jest.fn(),
  isPinLocked: jest.fn(() => false),
  getPinLockExpiry: jest.fn(() => null),
  PIN_MAX_ATTEMPTS: 5,
  PIN_LOCK_MINUTES: 15,
}));
jest.mock('../../src/utils/bankHours', () => ({
  accrueBankHours: jest.fn(),
  expireBankHoursIfNeeded: jest.fn(),
}));

const { clockIn, clockOut } = require('../../src/controllers/time.controller');

const HOUR = 60 * 60 * 1000;

describe('batida offline (occurredAt)', () => {
  let mockReq;
  let mockRes;

  const createArgs = () => mockPrisma.timeEntry.create.mock.calls[0][0];
  const updateArgs = () => mockPrisma.timeEntry.update.mock.calls[0][0];

  beforeEach(() => {
    // jest.config tem resetMocks: true, então as implementações dos mocks
    // precisam ser reinstaladas a cada teste.
    mockReq = {
      user: { id: 'user-123', email: 'member@test.com', name: 'Member', role: 'MEMBER' },
      body: { pin: '1234' },
      query: {},
      params: {},
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    captureRequestMetadata.mockReturnValue({
      ip: '127.0.0.1',
      device: 'OmniPunt Android',
      location: null,
    });

    evaluateGeofence.mockReturnValue({
      enabled: false,
      allowed: true,
      inside: true,
      hasCoordinates: false,
      reason: 'GEOFENCE_DISABLED',
    });

    // Usuário autentica por PIN (sem facial cadastrada).
    verifyPin.mockResolvedValue(true);
    mockPrisma.user.findUnique.mockResolvedValue({
      facialEmbedding: null,
      facialThreshold: 0.45,
      pinHash: 'hash',
      pinSalt: 'salt',
      pinFailedAttempts: 0,
      pinLockedUntil: null,
      contractDailyMinutes: 480,
      hourlyRate: 0,
    });
    mockPrisma.user.update.mockResolvedValue({});

    accrueBankHours.mockResolvedValue({
      accruedMinutes: 0,
      discardedMinutes: 0,
      balanceMinutes: 0,
      expiredMinutes: 0,
    });

    mockPrisma.timeEntry.findMany.mockResolvedValue([]);
    mockPrisma.timeEntry.create.mockResolvedValue({ id: 'entry-1', user: {} });
    mockPrisma.timeEntry.update.mockResolvedValue({ id: 'entry-1', user: {} });
  });

  describe('clock-in', () => {
    it('records an offline clock-in at the time it actually happened', async () => {
      const occurredAt = new Date(Date.now() - 4 * HOUR);
      mockPrisma.timeEntry.findFirst.mockResolvedValue(null);
      mockReq.body.occurredAt = occurredAt.toISOString();

      await clockIn(mockReq, mockRes);

      expect(mockPrisma.timeEntry.create).toHaveBeenCalled();
      expect(createArgs().data.clockIn.getTime()).toBe(occurredAt.getTime());

      const { offline } = createArgs().data.location;
      expect(offline.event).toBe('clockIn');
      expect(offline.occurredAt).toBe(occurredAt.toISOString());
      expect(offline.skewMs).toBeGreaterThanOrEqual(4 * HOUR - 5000);
      expect(offline.skewMs).toBeLessThanOrEqual(4 * HOUR + 5000);
      expect(typeof offline.syncedAt).toBe('string');
    });

    it('returns 400 INVALID_OCCURRED_AT for a future occurredAt', async () => {
      mockPrisma.timeEntry.findFirst.mockResolvedValue(null);
      mockReq.body.occurredAt = new Date(Date.now() + HOUR).toISOString();

      await clockIn(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'INVALID_OCCURRED_AT' })
      );
      expect(mockPrisma.timeEntry.create).not.toHaveBeenCalled();
    });

    it('returns 400 INVALID_OCCURRED_AT for a malformed occurredAt', async () => {
      mockPrisma.timeEntry.findFirst.mockResolvedValue(null);
      mockReq.body.occurredAt = 'ontem de manhã';

      await clockIn(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'INVALID_OCCURRED_AT' })
      );
      expect(mockPrisma.timeEntry.create).not.toHaveBeenCalled();
    });

    it('still uses the server clock when occurredAt is absent', async () => {
      mockPrisma.timeEntry.findFirst.mockResolvedValue(null);
      const before = Date.now();

      await clockIn(mockReq, mockRes);

      const { clockIn: stamped, location } = createArgs().data;
      expect(stamped.getTime()).toBeGreaterThanOrEqual(before);
      expect(stamped.getTime()).toBeLessThanOrEqual(Date.now());
      expect(location.offline).toBeUndefined();
    });
  });

  describe('clock-out', () => {
    const openEntry = (clockInAt) => ({
      id: 'entry-1',
      userId: 'user-123',
      clockIn: clockInAt,
      clockOut: null,
      notes: null,
      location: null,
      breakMinutes: 0,
      breakStartedAt: null,
      breaks: [],
    });

    it('computes worked minutes from the real punch interval, not the sync time', async () => {
      // Entrou 12h atrás, saiu 4h atrás, sincronizou agora: 8h trabalhadas.
      const occurredAt = new Date(Date.now() - 4 * HOUR);
      mockPrisma.timeEntry.findFirst.mockResolvedValue(openEntry(new Date(Date.now() - 12 * HOUR)));
      mockReq.body.occurredAt = occurredAt.toISOString();

      await clockOut(mockReq, mockRes);

      expect(mockPrisma.timeEntry.update).toHaveBeenCalled();
      const { data } = updateArgs();
      expect(data.clockOut.getTime()).toBe(occurredAt.getTime());
      // 8h e não 12h — 12h seria a hora da sincronização.
      expect(data.workedMinutes).toBe(480);
      expect(data.overtimeMinutes).toBe(0);
      expect(data.location.offline.event).toBe('clockOut');
      expect(data.location.offline.occurredAt).toBe(occurredAt.toISOString());
    });

    it('keeps the offline evidence of the clock-in when both punches came from the queue', async () => {
      const entry = openEntry(new Date(Date.now() - 12 * HOUR));
      entry.location = {
        clockIn: null,
        clockOut: null,
        geofence: { clockIn: null, clockOut: null },
        offline: { event: 'clockIn', occurredAt: '2026-08-28T08:00:00.000Z', syncedAt: '2026-08-28T12:00:00.000Z', skewMs: 4 * HOUR },
      };
      mockPrisma.timeEntry.findFirst.mockResolvedValue(entry);
      mockReq.body.occurredAt = new Date(Date.now() - 4 * HOUR).toISOString();

      await clockOut(mockReq, mockRes);

      expect(updateArgs().data.location.offline.clockIn.event).toBe('clockIn');
    });

    it('returns 400 INVALID_OCCURRED_AT for an occurredAt older than 48h', async () => {
      mockPrisma.timeEntry.findFirst.mockResolvedValue(openEntry(new Date(Date.now() - 72 * HOUR)));
      mockReq.body.occurredAt = new Date(Date.now() - 49 * HOUR).toISOString();

      await clockOut(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'INVALID_OCCURRED_AT' })
      );
      expect(mockPrisma.timeEntry.update).not.toHaveBeenCalled();
    });

    it('still uses the server clock when occurredAt is absent', async () => {
      mockPrisma.timeEntry.findFirst.mockResolvedValue(openEntry(new Date(Date.now() - 8 * HOUR)));
      const before = Date.now();

      await clockOut(mockReq, mockRes);

      const { data } = updateArgs();
      expect(data.clockOut.getTime()).toBeGreaterThanOrEqual(before);
      expect(data.clockOut.getTime()).toBeLessThanOrEqual(Date.now());
      expect(data.location.offline).toBeUndefined();
    });
  });
});
