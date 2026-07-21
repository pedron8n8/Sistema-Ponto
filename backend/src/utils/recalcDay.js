const { prisma } = require('../config/database');
const { calculateIncrementalOvertimeSummary } = require('./overtime');
const { accrueBankHours } = require('./bankHours');
const { getStartOfDay, getEndOfDay } = require('./timeCalculations');

/**
 * Reverte créditos de banco de horas (ACCRUAL) ainda PENDENTES vinculados a um registro,
 * ajustando o saldo do colaborador. Usado antes de recalcular ou ao excluir um registro,
 * para que o recálculo não gere contagem dupla.
 *
 * Créditos já PAGOS não são revertidos (não há como "despagar"); apenas têm o vínculo
 * com o registro removido pelo chamador, quando necessário.
 */
const reverseEntryBankHours = async (timeEntryId) => {
  if (!timeEntryId) return { reversedMinutes: 0 };

  const pendingAccruals = await prisma.bankHoursEntry.findMany({
    where: {
      timeEntryId,
      type: 'ACCRUAL',
      paymentStatus: 'PENDING',
      expiredAt: null,
    },
    select: { id: true, minutes: true, userId: true },
  });

  if (!pendingAccruals.length) return { reversedMinutes: 0 };

  const reversedMinutes = pendingAccruals.reduce((sum, item) => sum + Math.max(0, item.minutes), 0);
  const userId = pendingAccruals[0].userId;

  await prisma.bankHoursEntry.deleteMany({
    where: { id: { in: pendingAccruals.map((item) => item.id) } },
  });

  if (reversedMinutes > 0) {
    await prisma.user.update({
      where: { id: userId },
      data: { bankHoursBalanceMinutes: { decrement: reversedMinutes } },
    });
  }

  return { reversedMinutes };
};

/**
 * Recalcula minutos trabalhados, horas extras (50/100) e banco de horas de TODOS os
 * registros fechados (com clockOut) de um colaborador em um determinado dia.
 *
 * A divisão de horas extras depende da ordem cronológica das entradas do dia
 * (`calculateIncrementalOvertimeSummary`), por isso reprocessamos o dia inteiro em ordem.
 * Idempotente: reverte o crédito anterior de cada registro antes de re-creditar.
 *
 * @param {{ userId: string, date: Date|string }} params
 */
const recalculateUserDay = async ({ userId, date }) => {
  const dayStart = getStartOfDay(date);
  const dayEnd = getEndOfDay(date);

  const userConfig = await prisma.user.findUnique({
    where: { id: userId },
    select: { contractDailyMinutes: true },
  });

  const entries = await prisma.timeEntry.findMany({
    where: {
      userId,
      clockIn: { gte: dayStart, lte: dayEnd },
      clockOut: { not: null },
    },
    orderBy: { clockIn: 'asc' },
    select: { id: true, clockIn: true, clockOut: true, breakMinutes: true, status: true, overtimeStatus: true },
  });

  let workedMinutesBeforeEntry = 0;
  const results = [];

  for (const entry of entries) {
    // Remove crédito pendente anterior deste registro para evitar contagem dupla.
    await reverseEntryBankHours(entry.id);

    const overtime = calculateIncrementalOvertimeSummary({
      clockIn: entry.clockIn,
      clockOut: entry.clockOut,
      contractDailyMinutes: userConfig?.contractDailyMinutes,
      workedMinutesBeforeEntry,
      breakMinutes: entry.breakMinutes,
    });

    // HE negada é definitiva: mantém efeito zerado e não re-credita banco de horas,
    // mesmo que o recálculo do dia volte a produzir horas extras para este registro.
    if (entry.overtimeStatus === 'REJECTED') {
      await prisma.timeEntry.update({
        where: { id: entry.id },
        data: {
          workedMinutes: overtime.workedMinutes,
          overtimeMinutes: 0,
          overtimeMinutes50: 0,
          overtimeMinutes100: 0,
          overtimePercent: 0,
          bankHoursAccruedMinutes: 0,
        },
      });

      workedMinutesBeforeEntry += overtime.workedMinutes;
      results.push({
        id: entry.id,
        workedMinutes: overtime.workedMinutes,
        overtimeMinutes: 0,
        bankHoursAccruedMinutes: 0,
      });
      continue;
    }

    const bankHoursResult = await accrueBankHours({
      userId,
      overtimeMinutes: overtime.overtimeMinutes,
      timeEntryId: entry.id,
    });

    await prisma.timeEntry.update({
      where: { id: entry.id },
      data: {
        workedMinutes: overtime.workedMinutes,
        overtimeMinutes: overtime.overtimeMinutes,
        overtimeMinutes50: overtime.overtimeMinutes50,
        overtimeMinutes100: overtime.overtimeMinutes100,
        overtimePercent: overtime.overtimePercent,
        bankHoursAccruedMinutes: bankHoursResult.accruedMinutes,
        // Decisão de HE: aprovação sobrevive a mudanças de valor; registros já aprovados
        // (edição/criação do HR) auto-aprovam a HE; sem HE, limpa a pendência.
        overtimeStatus:
          overtime.overtimeMinutes > 0
            ? entry.overtimeStatus === 'APPROVED' || entry.status !== 'PENDING'
              ? 'APPROVED'
              : 'PENDING'
            : null,
      },
    });

    workedMinutesBeforeEntry += overtime.workedMinutes;
    results.push({
      id: entry.id,
      workedMinutes: overtime.workedMinutes,
      overtimeMinutes: overtime.overtimeMinutes,
      bankHoursAccruedMinutes: bankHoursResult.accruedMinutes,
    });
  }

  return results;
};

module.exports = {
  recalculateUserDay,
  reverseEntryBankHours,
};
