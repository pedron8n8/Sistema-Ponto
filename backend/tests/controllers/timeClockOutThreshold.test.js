// Asercoes de FORMA da query, nao de comportamento.
//
// O mock do Prisma e um jest.fn() e IGNORA `select`: ele devolve o que a gente
// enfileira, com os campos que a gente enfileirar. Entao um teste de
// comportamento passa igual com um select incompleto — foi assim que o
// clock-out ficou sem o limiar de HE curta apesar de haver 16 testes verdes
// para o limiar nos calculadores.
//
// A licao virou este arquivo: quando a corretude depende de um campo CHEGAR na
// linha, o teste tem que olhar a query, nao o resultado.

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

const {
  clockOut,
  getClockOutUserConfigSelect,
  getPriorEntriesSelect,
} = require('../../src/controllers/time.controller');

const HOUR = 60 * 60 * 1000;

describe('clock-out e o limiar de HE curta do tenant', () => {
  it('pede o limiar do tenant na leitura de configuracao do colaborador', () => {
    // Sem isto o clock-out gravava overtimeMinutes: 6 e overtimeStatus:
    // 'PENDING' num tenant com limiar de 10min, e HE pendente bloqueia a
    // aprovacao do ponto.
    expect(getClockOutUserConfigSelect()).toEqual({
      contractDailyMinutes: true,
      hourlyRate: true,
      organizationAdmin: { select: { overtimeMinMinutes: true } },
    });
  });
});

// O minuto que o limiar engole nao pode virar hora normal paga: espelho exato
// do que o recalculo do dia ja faz (recalcDay.js), so que na escrita que fecha
// o ponto pela primeira vez.
describe('clock-out corta do reconhecido o minuto que o limiar engoliu', () => {
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
    // Contrato 480, limiar do tenant 30: um turno de 500min tem 20min de
    // excedente, abaixo do limiar.
    mockPrisma.user.findUnique.mockResolvedValue({
      facialEmbedding: null,
      facialThreshold: 0.45,
      pinHash: 'hash',
      pinSalt: 'salt',
      pinFailedAttempts: 0,
      pinLockedUntil: null,
      contractDailyMinutes: 480,
      hourlyRate: 0,
      organizationAdmin: { overtimeMinMinutes: 30 },
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

  it('grava workedMinutes ja cortado e sem HE pendente quando o limiar engole o excedente', async () => {
    const clockInAt = new Date(Date.now() - 500 * 60 * 1000);
    stubTimeEntryFindFirst(mockPrisma, { open: openEntry(clockInAt) });
    mockReq.body.occurredAt = new Date().toISOString();

    await clockOut(mockReq, mockRes);

    expect(mockPrisma.timeEntry.update).toHaveBeenCalledTimes(1);
    expect(updateArgs().data.workedMinutes).toBe(480);
    expect(updateArgs().data.overtimeMinutes).toBe(0);
    expect(updateArgs().data.overtimeStatus).toBeNull();
  });

  it('nao corta o reconhecido quando o excedente cruza o limiar', async () => {
    // 495min de turno, 15min de excedente, limiar 30... este caso testa o
    // oposto: limiar 10, para o excedente de 15 ficar acima e virar HE real.
    mockPrisma.user.findUnique.mockResolvedValue({
      facialEmbedding: null,
      facialThreshold: 0.45,
      pinHash: 'hash',
      pinSalt: 'salt',
      pinFailedAttempts: 0,
      pinLockedUntil: null,
      contractDailyMinutes: 480,
      hourlyRate: 0,
      organizationAdmin: { overtimeMinMinutes: 10 },
    });
    const clockInAt = new Date(Date.now() - 495 * 60 * 1000);
    stubTimeEntryFindFirst(mockPrisma, { open: openEntry(clockInAt) });
    mockReq.body.occurredAt = new Date().toISOString();

    await clockOut(mockReq, mockRes);

    expect(updateArgs().data.overtimeMinutes).toBe(15);
    expect(updateArgs().data.workedMinutes).toBe(495);
  });
});

describe('marcacoes anteriores do dia', () => {
  it('pede overtimeStatus junto com workedMinutes', () => {
    // resolveWorkedMinutes precisa distinguir um 0 autoritativo (HE negada) de
    // um 0 por falta de calculo. Sem o campo, o fallback devolvia a duracao
    // cheia e os minutos negados voltavam para workedMinutesBeforeEntry,
    // inflando o total do dia e dando HE nova em cima de tempo ja negado.
    expect(getPriorEntriesSelect()).toEqual({
      clockIn: true,
      clockOut: true,
      workedMinutes: true,
      overtimeStatus: true,
    });
  });
});
