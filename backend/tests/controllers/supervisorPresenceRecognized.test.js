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

// A reversao de banco de horas do reject em lote acontecia num laco sequencial
// ANTES da transacao: o accrual ja estava apagado e o saldo decrementado quando
// a transacao rodava, entao uma falha dela deixava as marcacoes PENDING com o
// credito perdido, sem escrita compensatoria. Agora a LEITURA fica fora (nao
// causa dano) e as ESCRITAS entram na transacao.
describe('reversao de banco de horas no reject em lote', () => {
  it('planeja a reversao por leitura, agrupando o decremento por colaborador', async () => {
    const recalcDay = require('../../src/utils/recalcDay');

    mockPrisma.bankHoursEntry.findMany.mockResolvedValue([
      { id: 'a1', minutes: 60, userId: 'u1' },
      { id: 'a2', minutes: 30, userId: 'u1' },
      { id: 'a3', minutes: 45, userId: 'u2' },
    ]);

    const plano = await recalcDay.planEntryBankHoursReversal(['e1', 'e2', 'e3']);

    // Uma leitura so, no lugar de N x 3 queries sequenciais.
    expect(mockPrisma.bankHoursEntry.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.bankHoursEntry.findMany.mock.calls[0][0].where).toMatchObject({
      timeEntryId: { in: ['e1', 'e2', 'e3'] },
      type: 'ACCRUAL',
      paymentStatus: 'PENDING',
      expiredAt: null,
    });

    expect(plano.accrualIds).toEqual(['a1', 'a2', 'a3']);
    expect(plano.reversedMinutes).toBe(135);
    // Um lote cobre varias pessoas, e o saldo vive na linha de cada uma.
    expect(plano.decrementsByUser).toEqual([
      { userId: 'u1', minutes: 90 },
      { userId: 'u2', minutes: 45 },
    ]);
  });

  it('nao escreve nada — e so um plano', async () => {
    const recalcDay = require('../../src/utils/recalcDay');

    mockPrisma.bankHoursEntry.findMany.mockResolvedValue([
      { id: 'a1', minutes: 60, userId: 'u1' },
    ]);

    await recalcDay.planEntryBankHoursReversal(['e1']);

    expect(mockPrisma.bankHoursEntry.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('lista vazia nao vai ao banco', async () => {
    const recalcDay = require('../../src/utils/recalcDay');

    const plano = await recalcDay.planEntryBankHoursReversal([]);

    expect(mockPrisma.bankHoursEntry.findMany).not.toHaveBeenCalled();
    expect(plano).toEqual({ accrualIds: [], decrementsByUser: [], reversedMinutes: 0 });
  });

  it('ignora minutos negativos no total revertido', async () => {
    const recalcDay = require('../../src/utils/recalcDay');

    mockPrisma.bankHoursEntry.findMany.mockResolvedValue([
      { id: 'a1', minutes: -10, userId: 'u1' },
      { id: 'a2', minutes: 20, userId: 'u1' },
    ]);

    const plano = await recalcDay.planEntryBankHoursReversal(['e1']);

    // O accrual negativo continua sendo apagado, mas nao credita saldo de volta.
    expect(plano.accrualIds).toEqual(['a1', 'a2']);
    expect(plano.reversedMinutes).toBe(20);
    expect(plano.decrementsByUser).toEqual([{ userId: 'u1', minutes: 20 }]);
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
