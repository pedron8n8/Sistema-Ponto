// A cláusula que separa os dados de um colaborador dos de outro.
//
// clockIn e clockOut procuram o registro aberto com
// `where: { userId, clockOut: null }`. Apagar o `userId` de qualquer um dos dois
// não quebrava nenhum teste da suíte — o stub de findFirst devolvia o registro
// aberto para toda consulta `clockOut: null`, sem olhar o `userId`. No banco a
// consulta sem `userId` enxerga o turno aberto de OUTRO colaborador:
//
//   - no clock-out, o `update` fecharia o registro alheio, gravando nele
//     clockOut, workedMinutes, hora extra 50/100 e crédito de banco de horas de
//     quem bateu — folha de pagamento de duas pessoas corrompida de uma vez;
//   - no clock-in, o turno aberto de um colega bloquearia a entrada legítima
//     com 400 "você já possui um ponto aberto".
//
// Estes testes fixam o `userId` nos dois lookups.

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

const { clockIn, clockOut } = require('../../src/controllers/time.controller');

const HOUR = 60 * 60 * 1000;

describe('registro aberto é sempre do próprio colaborador', () => {
  let mockReq;
  let mockRes;

  // Turno aberto de OUTRA pessoa. O `userId` é o único campo que o distingue de
  // um registro do próprio usuário — é exatamente ele que o where tem que filtrar.
  const otherUserOpenEntry = () => ({
    id: 'entry-do-colega',
    userId: 'user-999',
    clockIn: new Date(Date.now() - 6 * HOUR),
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
    mockPrisma.timeEntry.create.mockResolvedValue({ id: 'entry-1', user: {} });
    mockPrisma.timeEntry.update.mockResolvedValue({ id: 'entry-1', user: {} });
  });

  it('clockIn: filtra o registro aberto por userId e não bloqueia por turno de colega', async () => {
    stubTimeEntryFindFirst(mockPrisma, { open: otherUserOpenEntry() });

    await clockIn(mockReq, mockRes);

    // Sem `userId` no where, o turno do colega vira "você já possui um ponto
    // aberto" e o colaborador não consegue bater a entrada dele.
    expect(mockRes.status).not.toHaveBeenCalledWith(400);
    expect(mockPrisma.timeEntry.create).toHaveBeenCalled();
    expect(mockPrisma.timeEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-123', clockOut: null }),
      })
    );
  });

  it('clockOut: filtra o registro aberto por userId e não fecha o turno de um colega', async () => {
    stubTimeEntryFindFirst(mockPrisma, { open: otherUserOpenEntry() });

    await clockOut(mockReq, mockRes);

    // Sem `userId` no where, o update fecharia `entry-do-colega` — clockOut,
    // minutos trabalhados, hora extra e banco de horas gravados na pessoa errada.
    expect(mockPrisma.timeEntry.update).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Não há registro de ponto aberto. Faça clock-in primeiro.',
      })
    );
    expect(mockPrisma.timeEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-123', clockOut: null }),
      })
    );
  });
});
