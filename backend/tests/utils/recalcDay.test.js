// recalculateUserDay reprocessa o dia inteiro e, no mesmo passo, decide o
// overtimeStatus do registro. accrueBankHours RELÊ o registro no banco para
// saber se o crédito está represado (batida offline aguardando aprovação), então
// a ordem entre "creditar" e "gravar a decisão" é o que define se o crédito sai.
//
// Regressão coberta aqui: creditando ANTES do update, um registro represado que
// o próprio update promove a APPROVED era lido ainda como PENDING. O crédito
// ficava represado e NADA mais o soltava — approveEntry, approveOvertime e o
// lote todos recusam registro que já saiu de PENDING. As horas sumiam do banco
// sem erro em lugar nenhum.

const mockPrisma = require('../mocks/prisma.mock');

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/utils/bankHours', () => ({
  accrueBankHours: jest.fn(),
}));

const { accrueBankHours } = require('../../src/utils/bankHours');
const { recalculateUserDay } = require('../../src/utils/recalcDay');

const HOUR = 60 * 60 * 1000;
const DAY = new Date('2026-08-28T12:00:00.000Z');

const deferredLocation = {
  offline: {
    event: 'clockOut',
    occurredAt: '2026-08-28T20:00:00.000Z',
    syncedAt: '2026-08-28T21:00:00.000Z',
    bankHoursDeferred: true,
  },
};

describe('recalculateUserDay', () => {
  // Banco de mentira só do necessário: o estado do registro é lido de volta por
  // accrueBankHours, então o update TEM que ser visível para a leitura seguinte.
  const arrangeEntry = (entry) => {
    const stored = { ...entry };

    mockPrisma.user.findUnique.mockResolvedValue({ contractDailyMinutes: 480 });
    mockPrisma.timeEntry.findMany.mockResolvedValue([stored]);
    mockPrisma.bankHoursEntry.findMany.mockResolvedValue([]);
    mockPrisma.timeEntry.update.mockImplementation(async ({ data }) => {
      Object.assign(stored, data);
      return stored;
    });
    mockPrisma.timeEntry.findUnique.mockImplementation(async () => stored);

    return stored;
  };

  // 12h de turno numa jornada de 8h => 240min de hora extra.
  const offlineShift = (over = {}) => ({
    id: 'entry-1',
    userId: 'user-123',
    clockIn: new Date(DAY.getTime() - 12 * HOUR),
    clockOut: new Date(DAY.getTime()),
    breakMinutes: 0,
    status: 'PENDING',
    overtimeStatus: 'PENDING',
    location: deferredLocation,
    ...over,
  });

  beforeEach(() => {
    // O guard real de accrueBankHours, reproduzido: crédito represado só sai
    // quando o registro JÁ está gravado como APPROVED.
    accrueBankHours.mockImplementation(async ({ overtimeMinutes, timeEntryId }) => {
      const minutes = Math.max(0, Math.floor(Number(overtimeMinutes) || 0));
      if (minutes <= 0) return { accruedMinutes: 0, discardedMinutes: 0 };

      const entry = await mockPrisma.timeEntry.findUnique({ where: { id: timeEntryId } });
      const deferred = entry?.location?.offline?.bankHoursDeferred === true;

      if (deferred && entry.overtimeStatus !== 'APPROVED') {
        return { accruedMinutes: 0, discardedMinutes: 0, deferredMinutes: minutes };
      }

      return { accruedMinutes: minutes, discardedMinutes: 0 };
    });
  });

  // O cenário que perdia horas: o RH corrige um registro nascido offline (por
  // exemplo, um typo nas notas) ANTES de o supervisor decidir a hora extra. O
  // hr.controller grava status: 'APPROVED' e chama o recálculo; o recálculo
  // promove overtimeStatus a APPROVED — e o crédito tem que sair junto.
  it('credits the deferred bank hours when the recalc itself promotes the entry to APPROVED', async () => {
    const stored = arrangeEntry(offlineShift({ status: 'APPROVED' }));

    const [result] = await recalculateUserDay({ userId: 'user-123', date: DAY });

    expect(result.overtimeMinutes).toBe(240);
    expect(stored.overtimeStatus).toBe('APPROVED');
    // O ponto da regressão: 240, não 0.
    expect(result.bankHoursAccruedMinutes).toBe(240);
    expect(stored.bankHoursAccruedMinutes).toBe(240);
  });

  it('writes the promotion before the accrual reads the entry back', async () => {
    // Guard-rail explícito da ordem: se alguém voltar a creditar antes do
    // update, o registro estará PENDING no momento da leitura e este teste cai.
    const stored = arrangeEntry(offlineShift({ status: 'APPROVED' }));
    let statusSeenByAccrual = null;

    mockPrisma.timeEntry.findUnique.mockImplementation(async () => {
      statusSeenByAccrual = stored.overtimeStatus;
      return stored;
    });

    await recalculateUserDay({ userId: 'user-123', date: DAY });

    expect(statusSeenByAccrual).toBe('APPROVED');
  });

  // O outro lado: o guard não pode virar letra morta. Um registro offline que
  // continua aguardando o supervisor não pode creditar nada.
  it('keeps the credit deferred while the offline entry is still awaiting the supervisor', async () => {
    const stored = arrangeEntry(offlineShift({ status: 'PENDING', overtimeStatus: 'PENDING' }));

    const [result] = await recalculateUserDay({ userId: 'user-123', date: DAY });

    expect(stored.overtimeStatus).toBe('PENDING');
    expect(result.bankHoursAccruedMinutes).toBe(0);
    expect(stored.bankHoursAccruedMinutes).toBe(0);
  });

  it('credits a normal (non-offline) entry with no approval needed', async () => {
    const stored = arrangeEntry(offlineShift({ location: null }));

    const [result] = await recalculateUserDay({ userId: 'user-123', date: DAY });

    expect(result.bankHoursAccruedMinutes).toBe(240);
    expect(stored.bankHoursAccruedMinutes).toBe(240);
  });

  it('keeps a REJECTED overtime at zero and never calls the accrual', async () => {
    const stored = arrangeEntry(offlineShift({ overtimeStatus: 'REJECTED' }));

    const [result] = await recalculateUserDay({ userId: 'user-123', date: DAY });

    expect(result.overtimeMinutes).toBe(0);
    expect(stored.bankHoursAccruedMinutes).toBe(0);
    expect(accrueBankHours).not.toHaveBeenCalled();
  });

  // HE negada sai do tempo reconhecido: turno de 12h numa jornada de 8h com os
  // 240min de HE negados vale 480min, não 720. Sem isso o total do período, o
  // relatório e o export continuavam mostrando as 12h que o supervisor negou.
  //
  // Desconta-se a HE da própria entrada em vez de cortar no contrato: num dia
  // com várias entradas a HE é incremental, e a segunda entrada pode ser HE de
  // ponta a ponta — cortar em 480 ali daria número errado.
  it('discounts the rejected overtime from the recognized worked minutes', async () => {
    const stored = arrangeEntry(offlineShift({ overtimeStatus: 'REJECTED' }));

    const [result] = await recalculateUserDay({ userId: 'user-123', date: DAY });

    expect(result.workedMinutes).toBe(480);
    expect(stored.workedMinutes).toBe(480);
    // clockIn/clockOut são o fato bruto e não se movem; workedMinutes é derivado.
    expect(stored.clockIn).toEqual(new Date(DAY.getTime() - 12 * HOUR));
    expect(stored.clockOut).toEqual(new Date(DAY.getTime()));
  });
  it('clears the stale accrued minutes when the recalc produces no credit', async () => {
    // O crédito anterior foi revertido por reverseEntryBankHours; deixar o
    // número velho na coluna mostraria banco de horas que não existe mais.
    const stored = arrangeEntry(
      offlineShift({ status: 'PENDING', overtimeStatus: 'PENDING', bankHoursAccruedMinutes: 240 })
    );

    await recalculateUserDay({ userId: 'user-123', date: DAY });

    expect(stored.bankHoursAccruedMinutes).toBe(0);
  });

  it('reverses the previous pending accrual before recomputing, to avoid double counting', async () => {
    arrangeEntry(offlineShift({ status: 'APPROVED' }));
    mockPrisma.bankHoursEntry.findMany.mockResolvedValue([
      { id: 'bh-1', minutes: 120, userId: 'user-123' },
    ]);
    mockPrisma.bankHoursEntry.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.user.update.mockResolvedValue({});

    await recalculateUserDay({ userId: 'user-123', date: DAY });

    expect(mockPrisma.bankHoursEntry.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['bh-1'] } },
    });
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { bankHoursBalanceMinutes: { decrement: 120 } } })
    );
  });
});

// Negar a HE de uma entrada não pode empurrar hora extra para a entrada
// seguinte do mesmo dia. O acumulador do dia segue somando o tempo CHEIO: o
// colaborador trabalhou aqueles minutos, negar é sobre reconhecimento, não
// sobre rebobinar o relógio do dia.
describe('recalculateUserDay across two entries on the same day', () => {
  const CONTRACT = 480;

  const first = (over = {}) => ({
    id: 'entry-a',
    userId: 'user-123',
    clockIn: new Date('2026-08-28T11:00:00.000Z'),
    clockOut: new Date('2026-08-28T21:00:00.000Z'), // 600min => 120min de HE
    breakMinutes: 0,
    status: 'PENDING',
    overtimeStatus: 'PENDING',
    location: null,
    ...over,
  });

  const second = (over = {}) => ({
    id: 'entry-b',
    userId: 'user-123',
    clockIn: new Date('2026-08-28T22:00:00.000Z'),
    clockOut: new Date('2026-08-28T23:00:00.000Z'), // 60min, todos HE incremental
    breakMinutes: 0,
    status: 'PENDING',
    overtimeStatus: 'PENDING',
    location: null,
    ...over,
  });

  const arrangeDay = (entries) => {
    const stored = entries.map((entry) => ({ ...entry }));
    const byId = new Map(stored.map((entry) => [entry.id, entry]));

    mockPrisma.user.findUnique.mockResolvedValue({ contractDailyMinutes: CONTRACT });
    mockPrisma.timeEntry.findMany.mockResolvedValue(stored);
    mockPrisma.bankHoursEntry.findMany.mockResolvedValue([]);
    mockPrisma.timeEntry.update.mockImplementation(async ({ where, data }) => {
      const target = byId.get(where.id);
      Object.assign(target, data);
      return target;
    });
    mockPrisma.timeEntry.findUnique.mockImplementation(async ({ where }) => byId.get(where.id));
    accrueBankHours.mockImplementation(async ({ overtimeMinutes }) => ({
      accruedMinutes: Math.max(0, Math.floor(Number(overtimeMinutes) || 0)),
      discardedMinutes: 0,
    }));

    return byId;
  };

  it('gives the second entry its overtime when nothing is rejected', async () => {
    arrangeDay([first(), second()]);

    const results = await recalculateUserDay({ userId: 'user-123', date: DAY });

    expect(results.find((r) => r.id === 'entry-a').overtimeMinutes).toBe(120);
    expect(results.find((r) => r.id === 'entry-b').overtimeMinutes).toBe(60);
  });

  it('does not shift overtime onto the second entry when the first is rejected', async () => {
    const byId = arrangeDay([first({ overtimeStatus: 'REJECTED' }), second()]);

    const results = await recalculateUserDay({ userId: 'user-123', date: DAY });

    // Primeira entrada: HE zerada e reconhecido descontado.
    expect(results.find((r) => r.id === 'entry-a').overtimeMinutes).toBe(0);
    expect(byId.get('entry-a').workedMinutes).toBe(480);

    // Segunda entrada: exatamente a mesma HE do cenário sem negação.
    expect(results.find((r) => r.id === 'entry-b').overtimeMinutes).toBe(60);
    expect(byId.get('entry-b').workedMinutes).toBe(60);
  });
});

// O limiar de HE curta e configurado POR TENANT (User.overtimeMinMinutes do dono
// da organizacao), nao por colaborador: quem habilita e o ADMIN/INTEGRATOR da
// conta. O recalculo tem que resolver isso a partir do dono — senao a regra que
// o admin ligou no painel simplesmente nao vale no fechamento do dia.
describe('recalculateUserDay com limiar de HE curta do tenant', () => {
  const START = new Date('2026-08-28T11:00:00.000Z');

  const arrangeWithThreshold = (overtimeMinMinutes, workedMinutes) => {
    const stored = {
      id: 'entry-short',
      userId: 'user-123',
      clockIn: START,
      clockOut: new Date(START.getTime() + workedMinutes * 60000),
      breakMinutes: 0,
      status: 'PENDING',
      overtimeStatus: null,
      location: null,
    };

    mockPrisma.user.findUnique.mockResolvedValue({
      contractDailyMinutes: 480,
      organizationAdmin: overtimeMinMinutes === undefined ? null : { overtimeMinMinutes },
    });
    mockPrisma.timeEntry.findMany.mockResolvedValue([stored]);
    mockPrisma.bankHoursEntry.findMany.mockResolvedValue([]);
    mockPrisma.timeEntry.update.mockImplementation(async ({ data }) => {
      Object.assign(stored, data);
      return stored;
    });
    mockPrisma.timeEntry.findUnique.mockImplementation(async () => stored);
    accrueBankHours.mockResolvedValue({ accruedMinutes: 0, discardedMinutes: 0 });

    return stored;
  };

  it('zera a HE abaixo do limiar do tenant', async () => {
    const stored = arrangeWithThreshold(10, 485); // 5min de HE

    const [result] = await recalculateUserDay({ userId: 'user-123', date: DAY });

    expect(result.overtimeMinutes).toBe(0);
    // Sem HE a decidir, nao pode sobrar pendencia na fila do supervisor.
    expect(stored.overtimeStatus).toBeNull();
    // O tempo trabalhado e fato e nao muda por causa do limiar.
    expect(stored.workedMinutes).toBe(485);
  });

  it('mantem a HE que cruza o limiar do tenant', async () => {
    arrangeWithThreshold(10, 495); // 15min de HE

    const [result] = await recalculateUserDay({ userId: 'user-123', date: DAY });

    expect(result.overtimeMinutes).toBe(15);
  });

  it('nao aplica limiar nenhum quando o tenant nao configurou', async () => {
    arrangeWithThreshold(null, 485);

    const [result] = await recalculateUserDay({ userId: 'user-123', date: DAY });

    expect(result.overtimeMinutes).toBe(5);
  });

  it('tolera colaborador sem dono de organizacao', async () => {
    arrangeWithThreshold(undefined, 485);

    const [result] = await recalculateUserDay({ userId: 'user-123', date: DAY });

    expect(result.overtimeMinutes).toBe(5);
  });
});
