// O clock-out e o momento em que a tolerancia da empresa vira numero gravado.
// Duas coisas tem que sair certas do mesmo write: a hora extra ja filtrada pelo
// buffer, e o buffer usado, carimbado no registro para o recalculo do dia nao
// reler a configuracao atual depois.

const mockPrisma = require('../mocks/prisma.mock');
const { stubTimeEntryFindFirst } = require('../mocks/timeEntryFindFirst');
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

const MINUTE = 60 * 1000;

describe('clock-out com buffer de hora extra', () => {
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

  // Fecha um turno de `workedMinutes` minutos agora mesmo.
  const closeShiftOf = async (workedMinutes) => {
    const clockInAt = new Date(Date.now() - workedMinutes * MINUTE);
    stubTimeEntryFindFirst(mockPrisma, { open: openEntry(clockInAt) });
    await clockOut(mockReq, mockRes);
  };

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

    captureRequestMetadata.mockReturnValue({ ip: '127.0.0.1', device: 'OmniPunt Android', location: null });
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
      organizationAdminId: 'admin-1',
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
    mockPrisma.appSetting.findUnique.mockResolvedValue({ value: { bufferMinutes: 10 } });
  });

  it('fecha sem hora extra quando o dia ficou dentro do buffer da empresa', async () => {
    await closeShiftOf(488);

    expect(updateArgs().data.overtimeMinutes).toBe(0);
    // Sem hora extra pendente, o gate OVERTIME_PENDING nao trava a aprovacao.
    expect(updateArgs().data.overtimeStatus).toBeNull();
  });

  it('paga o excedente inteiro quando o dia passa do buffer', async () => {
    await closeShiftOf(505);

    // Gatilho, nao desconto: 25 continua valendo 25.
    expect(updateArgs().data.overtimeMinutes).toBe(25);
    expect(updateArgs().data.overtimeStatus).toBe('PENDING');
  });

  it('carimba no registro o buffer usado', async () => {
    await closeShiftOf(505);

    expect(updateArgs().data.overtimeBufferMinutes).toBe(10);
  });

  it('le o buffer da empresa do colaborador, nao do colaborador', async () => {
    await closeShiftOf(505);

    expect(mockPrisma.appSetting.findUnique).toHaveBeenCalledWith({
      where: { key: 'overtimeBuffer:admin-1' },
    });
  });

  it('mantem o comportamento de hoje quando a empresa nunca configurou', async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);

    await closeShiftOf(481);

    expect(updateArgs().data.overtimeMinutes).toBe(1);
    expect(updateArgs().data.overtimeStatus).toBe('PENDING');
    expect(updateArgs().data.overtimeBufferMinutes).toBe(0);
  });

  it('nao derruba o clock-out quando a leitura do buffer falha', async () => {
    mockPrisma.appSetting.findUnique.mockRejectedValue(new Error('connection refused'));

    await closeShiftOf(505);

    expect(mockRes.status).not.toHaveBeenCalledWith(500);
    expect(updateArgs().data.overtimeMinutes).toBe(25);
    expect(updateArgs().data.overtimeBufferMinutes).toBe(0);
  });
});
