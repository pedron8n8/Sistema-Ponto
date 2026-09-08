// O scan do alerta proativo recebeu o limiar de HE curta, mas nao a regra de
// tempo reconhecido: closedEntriesToday nao trazia overtimeStatus e o reducer
// tratava o 0 gravado como "nao calculado", recalculando a duracao cheia. O
// alerta de limite de HE chegava ao gestor por horas que o proprio gestor ja
// tinha negado.

const mockPrisma = require('../mocks/prisma.mock');

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
// A fila do BullMQ abre um ioredis com maxRetriesPerRequest: null no require do
// modulo. Sem este mock o teste ficaria tentando conectar para sempre.
jest.mock('../../src/config/redis', () => ({}));
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), on: jest.fn() })),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn() })),
}));

const {
  getClosedEntriesSelect,
  sumRecognizedMinutesByUser,
} = require('../../src/workers/proactiveAlertWorker');

const at = (iso) => new Date(iso);

describe('select das marcacoes fechadas do dia', () => {
  it('traz overtimeStatus junto com workedMinutes', () => {
    expect(getClosedEntriesSelect()).toEqual({
      userId: true,
      clockIn: true,
      clockOut: true,
      workedMinutes: true,
      overtimeStatus: true,
    });
  });
});

describe('sumRecognizedMinutesByUser', () => {
  it('nao soma a duracao cheia de uma entrada com HE negada', () => {
    const totals = sumRecognizedMinutesByUser([
      // Jornada normal de 8h.
      {
        userId: 'u1',
        workedMinutes: 480,
        overtimeStatus: null,
        clockIn: at('2026-08-28T09:00:00Z'),
        clockOut: at('2026-08-28T17:00:00Z'),
      },
      // Turno extra de 1h com a HE negada: reconhecido 0, de proposito.
      {
        userId: 'u1',
        workedMinutes: 0,
        overtimeStatus: 'REJECTED',
        clockIn: at('2026-08-28T18:00:00Z'),
        clockOut: at('2026-08-28T19:00:00Z'),
      },
    ]);

    // Antes da correcao dava 540: os 60min negados voltavam pelo fallback.
    expect(totals.u1).toBe(480);
  });

  it('ainda cura registro legado que nunca passou pelo recalculo', () => {
    const totals = sumRecognizedMinutesByUser([
      {
        userId: 'u2',
        workedMinutes: 0,
        overtimeStatus: null,
        clockIn: at('2026-08-28T09:00:00Z'),
        clockOut: at('2026-08-28T13:00:00Z'),
      },
    ]);

    expect(totals.u2).toBe(240);
  });

  it('confia no valor positivo gravado', () => {
    const totals = sumRecognizedMinutesByUser([
      {
        userId: 'u3',
        workedMinutes: 300,
        overtimeStatus: 'APPROVED',
        clockIn: at('2026-08-28T09:00:00Z'),
        clockOut: at('2026-08-28T17:00:00Z'),
      },
    ]);

    expect(totals.u3).toBe(300);
  });

  it('tolera lista vazia ou ausente', () => {
    expect(sumRecognizedMinutesByUser([])).toEqual({});
    expect(sumRecognizedMinutesByUser(undefined)).toEqual({});
  });
});
