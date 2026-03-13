const prisma = require('../config/database');

const clampPositiveInteger = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

const addMonths = (date, months) => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
};

const expireBankHoursIfNeeded = async (userId) => {
  const now = new Date();

  const expiredAccruals = await prisma.bankHoursEntry.findMany({
    where: {
      userId,
      type: 'ACCRUAL',
      expiredAt: null,
      expiresAt: { lte: now },
    },
    select: {
      id: true,
      minutes: true,
    },
  });

  if (!expiredAccruals.length) {
    return {
      expiredMinutes: 0,
    };
  }

  const expiredMinutes = expiredAccruals.reduce((sum, item) => sum + Math.max(0, item.minutes), 0);

  if (expiredMinutes <= 0) {
    return {
      expiredMinutes: 0,
    };
  }

  await prisma.bankHoursEntry.updateMany({
    where: {
      id: { in: expiredAccruals.map((item) => item.id) },
    },
    data: {
      expiredAt: now,
    },
  });

  await prisma.bankHoursEntry.create({
    data: {
      userId,
      type: 'EXPIRY',
      paymentStatus: 'PAID',
      paidAt: now,
      minutes: -expiredMinutes,
      description: 'Expiração automática de banco de horas',
      createdAt: now,
    },
  });

  await prisma.user.update({
    where: { id: userId },
    data: {
      bankHoursBalanceMinutes: {
        decrement: expiredMinutes,
      },
    },
  });

  return {
    expiredMinutes,
  };
};

const accrueBankHours = async ({ userId, overtimeMinutes, timeEntryId }) => {
  const minutes = Math.max(0, Math.floor(Number(overtimeMinutes) || 0));

  if (minutes <= 0) {
    return {
      accruedMinutes: 0,
      discardedMinutes: 0,
      balanceMinutes: null,
      expiredMinutes: 0,
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      bankHoursBalanceMinutes: true,
      bankHoursLimitMinutes: true,
      bankHoursExpiryMonths: true,
      bankHoursPolicyCode: true,
    },
  });

  if (!user) {
    return {
      accruedMinutes: 0,
      discardedMinutes: minutes,
      balanceMinutes: null,
      expiredMinutes: 0,
    };
  }

  const { expiredMinutes } = await expireBankHoursIfNeeded(userId);

  const freshUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      bankHoursBalanceMinutes: true,
      bankHoursLimitMinutes: true,
      bankHoursExpiryMonths: true,
      bankHoursPolicyCode: true,
    },
  });

  const currentBalance = freshUser?.bankHoursBalanceMinutes || 0;
  const limitMinutes =
    freshUser?.bankHoursLimitMinutes !== null && freshUser?.bankHoursLimitMinutes !== undefined
      ? Math.max(0, Math.floor(freshUser.bankHoursLimitMinutes))
      : null;

  const availableSpace = limitMinutes === null ? minutes : Math.max(0, limitMinutes - currentBalance);
  const accruedMinutes = Math.min(minutes, availableSpace);
  const discardedMinutes = minutes - accruedMinutes;

  let balanceMinutes = currentBalance;

  if (accruedMinutes > 0) {
    const expiryMonths = clampPositiveInteger(freshUser?.bankHoursExpiryMonths, 6);
    const now = new Date();

    await prisma.bankHoursEntry.create({
      data: {
        userId,
        timeEntryId: timeEntryId || null,
        type: 'ACCRUAL',
        paymentStatus: 'PENDING',
        minutes: accruedMinutes,
        description:
          discardedMinutes > 0
            ? 'Crédito parcial de banco de horas (limite aplicado)'
            : 'Crédito automático de banco de horas no clock-out',
        expiresAt: addMonths(now, expiryMonths),
      },
    });

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        bankHoursBalanceMinutes: {
          increment: accruedMinutes,
        },
      },
      select: {
        bankHoursBalanceMinutes: true,
      },
    });

    balanceMinutes = updatedUser.bankHoursBalanceMinutes;
  }

  return {
    accruedMinutes,
    discardedMinutes,
    balanceMinutes,
    expiredMinutes,
    policyCode: freshUser?.bankHoursPolicyCode || null,
    limitMinutes,
  };
};

const adjustBankHours = async ({ userId, actorId, minutesDelta, reason, resetToZero }) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      bankHoursBalanceMinutes: true,
      bankHoursLimitMinutes: true,
    },
  });

  if (!user) {
    return null;
  }

  await expireBankHoursIfNeeded(userId);

  const freshUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      bankHoursBalanceMinutes: true,
      bankHoursLimitMinutes: true,
    },
  });

  const currentBalance = freshUser?.bankHoursBalanceMinutes || 0;
  const parsedDelta = Math.trunc(Number(minutesDelta) || 0);
  const targetDelta = resetToZero ? -currentBalance : parsedDelta;

  if (targetDelta === 0) {
    return {
      userId,
      previousBalance: currentBalance,
      appliedDelta: 0,
      balanceMinutes: currentBalance,
    };
  }

  const maxLimit =
    freshUser?.bankHoursLimitMinutes !== null && freshUser?.bankHoursLimitMinutes !== undefined
      ? Math.max(0, Math.floor(freshUser.bankHoursLimitMinutes))
      : null;

  let appliedDelta = targetDelta;
  if (maxLimit !== null && currentBalance + appliedDelta > maxLimit) {
    appliedDelta = maxLimit - currentBalance;
  }

  const nextBalance = currentBalance + appliedDelta;

  await prisma.user.update({
    where: { id: userId },
    data: {
      bankHoursBalanceMinutes: nextBalance,
    },
  });

  await prisma.bankHoursEntry.create({
    data: {
      userId,
      createdById: actorId || null,
      type: 'ADJUSTMENT',
      paymentStatus: 'PAID',
      paidAt: new Date(),
      paidById: actorId || null,
      minutes: appliedDelta,
      description: reason || (resetToZero ? 'Zerar saldo do banco de horas' : 'Ajuste manual de banco de horas'),
    },
  });

  return {
    userId,
    previousBalance: currentBalance,
    appliedDelta,
    balanceMinutes: nextBalance,
    maxLimit,
  };
};

const settleBankHoursAccruals = async ({ userId, actorId, entryIds, payAllPending = true, paymentNote }) => {
  await expireBankHoursIfNeeded(userId);

  const pendingWhere = {
    userId,
    type: 'ACCRUAL',
    paymentStatus: 'PENDING',
    minutes: { gt: 0 },
    expiredAt: null,
  };

  if (!payAllPending && Array.isArray(entryIds) && entryIds.length > 0) {
    pendingWhere.id = { in: entryIds };
  }

  const pendingEntries = await prisma.bankHoursEntry.findMany({
    where: pendingWhere,
    select: {
      id: true,
      minutes: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  if (!pendingEntries.length) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { bankHoursBalanceMinutes: true },
    });

    return {
      paidMinutes: 0,
      paidEntries: 0,
      balanceMinutes: user?.bankHoursBalanceMinutes || 0,
    };
  }

  const paidMinutes = pendingEntries.reduce((sum, item) => sum + Math.max(0, item.minutes), 0);
  const now = new Date();

  const userBefore = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      bankHoursBalanceMinutes: true,
    },
  });

  const currentBalance = userBefore?.bankHoursBalanceMinutes || 0;
  const appliedMinutes = Math.min(currentBalance, paidMinutes);

  if (appliedMinutes <= 0) {
    return {
      paidMinutes: 0,
      paidEntries: 0,
      balanceMinutes: currentBalance,
    };
  }

  await prisma.$transaction([
    prisma.bankHoursEntry.updateMany({
      where: {
        id: { in: pendingEntries.map((item) => item.id) },
      },
      data: {
        paymentStatus: 'PAID',
        paidAt: now,
        paidById: actorId || null,
        paymentNote: paymentNote || 'Baixa manual de banco de horas',
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: {
        bankHoursBalanceMinutes: {
          decrement: appliedMinutes,
        },
      },
    }),
    prisma.bankHoursEntry.create({
      data: {
        userId,
        type: 'ADJUSTMENT',
        paymentStatus: 'PAID',
        paidAt: now,
        paidById: actorId || null,
        createdById: actorId || null,
        minutes: -appliedMinutes,
        description: 'Baixa de banco de horas (pago)',
        paymentNote: paymentNote || null,
      },
    }),
  ]);

  const userAfter = await prisma.user.findUnique({
    where: { id: userId },
    select: { bankHoursBalanceMinutes: true },
  });

  return {
    paidMinutes: appliedMinutes,
    paidEntries: pendingEntries.length,
    balanceMinutes: userAfter?.bankHoursBalanceMinutes || 0,
  };
};

module.exports = {
  accrueBankHours,
  adjustBankHours,
  expireBankHoursIfNeeded,
  settleBankHoursAccruals,
};
