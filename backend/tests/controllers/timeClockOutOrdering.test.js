// Fronteira de confiança do clock-out offline: resolvePunchTimestamp é puro e
// não enxerga o registro aberto, então sozinho ele aceita uma saída ANTERIOR à
// própria entrada. Isso produziria um intervalo negativo, que desce direto para
// workedMinutes, hora extra 50/100 e banco de horas — folha de pagamento
// corrompida a partir de entrada não validada do cliente. Aqui o guard rejeita.

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

const { clockOut } = require('../../src/controllers/time.controller');

const HOUR = 60 * 60 * 1000;

describe('clock-out offline anterior ao clock-in', () => {
  let mockReq;
  let mockRes;

  const updateArgs = () => mockPrisma.timeEntry.update.mock.calls[0][0];

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

  beforeEach(() => {
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
    mockPrisma.timeEntry.update.mockResolvedValue({ id: 'entry-1', user: {} });
  });

  it('rejects an occurredAt one hour before the open entry clockIn with 400', async () => {
    const clockInAt = new Date(Date.now() - 3 * HOUR);
    mockPrisma.timeEntry.findFirst.mockResolvedValue(openEntry(clockInAt));
    mockReq.body.occurredAt = new Date(clockInAt.getTime() - HOUR).toISOString();

    await clockOut(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Bad Request',
        code: 'OCCURRED_AT_BEFORE_CLOCK_IN',
        message: expect.any(String),
      })
    );
    // Nada de intervalo negativo escorrendo para workedMinutes / hora extra.
    expect(mockPrisma.timeEntry.update).not.toHaveBeenCalled();
    expect(accrueBankHours).not.toHaveBeenCalled();
  });

  it('rejects an occurredAt one millisecond before the clockIn', async () => {
    const clockInAt = new Date(Date.now() - 2 * HOUR);
    mockPrisma.timeEntry.findFirst.mockResolvedValue(openEntry(clockInAt));
    mockReq.body.occurredAt = new Date(clockInAt.getTime() - 1).toISOString();

    await clockOut(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockPrisma.timeEntry.update).not.toHaveBeenCalled();
  });

  it('accepts a normal offline clock-out after the clockIn', async () => {
    // O guard não pode ser largo demais: a batida offline legítima continua passando.
    const clockInAt = new Date(Date.now() - 12 * HOUR);
    const occurredAt = new Date(Date.now() - 4 * HOUR);
    mockPrisma.timeEntry.findFirst.mockResolvedValue(openEntry(clockInAt));
    mockReq.body.occurredAt = occurredAt.toISOString();

    await clockOut(mockReq, mockRes);

    expect(mockRes.status).not.toHaveBeenCalledWith(400);
    expect(mockPrisma.timeEntry.update).toHaveBeenCalledTimes(1);
    expect(updateArgs().data.clockOut.getTime()).toBe(occurredAt.getTime());
    expect(updateArgs().data.workedMinutes).toBe(480);
  });

  it('accepts an occurredAt exactly equal to the clockIn', async () => {
    const clockInAt = new Date(Date.now() - 2 * HOUR);
    mockPrisma.timeEntry.findFirst.mockResolvedValue(openEntry(clockInAt));
    mockReq.body.occurredAt = clockInAt.toISOString();

    await clockOut(mockReq, mockRes);

    expect(mockPrisma.timeEntry.update).toHaveBeenCalledTimes(1);
    expect(updateArgs().data.workedMinutes).toBe(0);
  });
});
