// Crédito de banco de horas mexe no saldo do colaborador na hora
// (user.bankHoursBalanceMinutes: { increment }). Num registro nascido de batida
// offline o intervalo saiu de horário escolhido pelo CLIENTE, então esse
// crédito não pode sair antes de um humano olhar: fica represado até o
// supervisor aprovar a hora extra.

const mockPrisma = require('../mocks/prisma.mock');

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const { accrueBankHours, isBankHoursDeferred } = require('../../src/utils/bankHours');

const deferredLocation = {
  clockIn: null,
  clockOut: null,
  offline: {
    event: 'clockOut',
    occurredAt: '2026-08-28T22:00:00.000Z',
    syncedAt: '2026-08-29T08:00:00.000Z',
    skewMs: 10 * 60 * 60 * 1000,
    bankHoursDeferred: true,
  },
};

describe('isBankHoursDeferred', () => {
  it('is true only for an entry marked by the offline punch path', () => {
    expect(isBankHoursDeferred({ location: deferredLocation })).toBe(true);
  });

  it.each([
    ['no entry', undefined],
    ['no location', { location: null }],
    ['a legacy string location', { location: 'lat,long' }],
    ['a location with no offline block', { location: { clockIn: null } }],
    ['an offline block without the flag', { location: { offline: { event: 'clockOut' } } }],
  ])('is false for %s', (_label, entry) => {
    expect(isBankHoursDeferred(entry)).toBe(false);
  });
});

describe('accrueBankHours', () => {
  const arrangeUser = () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-123',
      bankHoursBalanceMinutes: 0,
      bankHoursLimitMinutes: null,
      bankHoursExpiryMonths: 6,
      bankHoursPolicyCode: 'CLT',
    });
    mockPrisma.user.update.mockResolvedValue({ bankHoursBalanceMinutes: 120 });
    mockPrisma.bankHoursEntry.findMany.mockResolvedValue([]);
    mockPrisma.bankHoursEntry.create.mockResolvedValue({ id: 'bh-1' });
  };

  beforeEach(() => {
    arrangeUser();
  });

  it('does not move the balance for an offline entry still awaiting approval', async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue({
      location: deferredLocation,
      overtimeStatus: 'PENDING',
    });

    const result = await accrueBankHours({
      userId: 'user-123',
      overtimeMinutes: 120,
      timeEntryId: 'entry-1',
    });

    expect(result.accruedMinutes).toBe(0);
    expect(result.deferredMinutes).toBe(120);
    // O que importa: nada de increment no saldo e nenhum lançamento criado.
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(mockPrisma.bankHoursEntry.create).not.toHaveBeenCalled();
  });

  it('releases the credit once the supervisor approved the overtime', async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue({
      location: deferredLocation,
      overtimeStatus: 'APPROVED',
    });

    const result = await accrueBankHours({
      userId: 'user-123',
      overtimeMinutes: 120,
      timeEntryId: 'entry-1',
    });

    expect(result.accruedMinutes).toBe(120);
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { bankHoursBalanceMinutes: { increment: 120 } },
      })
    );
  });

  it('still credits a normal punch at clock-out, with no approval needed', async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue({
      location: { clockIn: null, clockOut: null },
      overtimeStatus: 'PENDING',
    });

    const result = await accrueBankHours({
      userId: 'user-123',
      overtimeMinutes: 120,
      timeEntryId: 'entry-1',
    });

    expect(result.accruedMinutes).toBe(120);
    expect(mockPrisma.user.update).toHaveBeenCalled();
  });

  it('skips the extra lookup when there is nothing to accrue', async () => {
    const result = await accrueBankHours({
      userId: 'user-123',
      overtimeMinutes: 0,
      timeEntryId: 'entry-1',
    });

    expect(result.accruedMinutes).toBe(0);
    expect(mockPrisma.timeEntry.findUnique).not.toHaveBeenCalled();
  });
});
