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
