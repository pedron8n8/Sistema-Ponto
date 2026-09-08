// O guard isWorkedMinutesAuthoritative no snapshot de presenca nasceu MORTO: o
// select de todayEntries nao trazia overtimeStatus, entao a comparacao era
// sempre `undefined === 'REJECTED'` e o fallback devolvia a duracao cheia da
// entrada — as horas que o supervisor negou voltavam para closedWorkedMinutesToday,
// para overtimeMinutesSoFar, para o status OVERTIME_ACTIVE e para o alerta de
// limite de HE.
//
// Nada disso quebrava: o numero so ficava errado. E o mock do Prisma e um
// jest.fn() que IGNORA `select`, entao nenhum teste de comportamento pegaria.
// Daí a asercao ser sobre a FORMA da query.

const mockPrisma = require('../mocks/prisma.mock');

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const {
  RECOGNIZED_MINUTES_SELECT,
  assertOvertimeStatusSelected,
} = require('../../src/utils/recognizedMinutes');
const { getTodayEntriesSelect } = require('../../src/controllers/supervisor.controller');

describe('select das marcacoes do dia no snapshot de presenca', () => {
  it('traz overtimeStatus, senao o guard e codigo morto', () => {
    expect(getTodayEntriesSelect()).toEqual({
      id: true,
      userId: true,
      clockIn: true,
      clockOut: true,
      location: true,
      updatedAt: true,
      workedMinutes: true,
      overtimeStatus: true,
    });
  });

  it('espalha o fragmento compartilhado em vez de listar os campos a mao', () => {
    const select = getTodayEntriesSelect();

    Object.entries(RECOGNIZED_MINUTES_SELECT).forEach(([field, value]) => {
      expect(select[field]).toBe(value);
    });
  });
});

describe('rejectOvertime e a corrida', () => {
  it('leva o predicado de estado no proprio UPDATE', () => {
    const { getRejectOvertimeWhere } = require('../../src/controllers/supervisor.controller');

    // Convencao do projeto: a concorrencia vive no predicado do UPDATE, nao
    // numa leitura anterior. O caminho em LOTE ja fazia isso; o de UMA entrada
    // escrevia com `where: { id }`, e nada impedia o perdedor de uma corrida
    // de sobrescrever a decisao de quem chegou primeiro.
    expect(getRejectOvertimeWhere('entry-1')).toEqual({
      id: 'entry-1',
      overtimeStatus: 'PENDING',
    });
  });
});

describe('a asercao pega a regressao que existia antes', () => {
  it('explode com a forma antiga do select', () => {
    // Exatamente o que a query devolvia antes da correcao.
    const rowFromOldSelect = {
      id: 'e1',
      userId: 'u1',
      clockIn: new Date('2026-08-28T18:00:00Z'),
      clockOut: new Date('2026-08-28T19:00:00Z'),
      workedMinutes: 0,
      location: null,
      updatedAt: new Date(),
    };

    expect(() => assertOvertimeStatusSelected(rowFromOldSelect, 'supervisor.presence')).toThrow(
      /overtimeStatus/
    );
  });
});
