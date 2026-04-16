const { Queue, Worker } = require('bullmq');
const prisma = require('../config/database');
const redis = require('../config/redis');
const {
  sendOvertimeThresholdNotification,
  getEnabledOvertimeChannels,
} = require('../utils/notifications');

const SCAN_JOB_NAME = 'scan-end-of-shift-overtime';
const DISPATCH_JOB_NAME = 'dispatch-end-of-shift-overtime';
const SCAN_REPEAT_JOB_ID = 'scan-end-of-shift-overtime-repeat';

const toPositiveNumber = (value, fallback, minimum = 1) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, parsed);
};

const PROACTIVE_SCAN_INTERVAL_MS = toPositiveNumber(
  process.env.PROACTIVE_ALERT_SCAN_INTERVAL_MS,
  60000,
  30000
);
const PROACTIVE_END_SHIFT_WINDOW_MINUTES = toPositiveNumber(
  process.env.PROACTIVE_ALERT_END_SHIFT_WINDOW_MINUTES,
  20,
  5
);
const PROACTIVE_POST_SHIFT_GRACE_MINUTES = toPositiveNumber(
  process.env.PROACTIVE_ALERT_POST_SHIFT_GRACE_MINUTES,
  90,
  5
);

const DEFAULT_OVERTIME_LIMIT_MINUTES = toPositiveNumber(
  process.env.OVERTIME_DAILY_LIMIT_MINUTES,
  120,
  1
);
const OVERTIME_ALERT_THRESHOLD_PERCENT = Math.max(
  1,
  Math.min(100, Number(process.env.OVERTIME_ALERT_THRESHOLD_PERCENT || 80))
);
const EXPLICIT_ALERT_CHANNELS = String(process.env.PROACTIVE_ALERT_CHANNELS || '')
  .split(',')
  .map((channel) => channel.trim().toUpperCase())
  .filter((channel) => ['EMAIL', 'PUSH', 'IN_APP'].includes(channel));

const proactiveAlertQueue = new Queue('proactive-overtime-alerts', {
  connection: redis,
});

const parseTimeToMinutes = (time) => {
  const normalized = String(time || '').trim();
  if (!normalized) return null;

  const match = normalized.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return hours * 60 + minutes;
};

const getNowMinutesForTimeZone = (timeZone) => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date());

    const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);

    return hour * 60 + minute;
  } catch (_error) {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }
};

const getDateKeyForTimeZone = (timeZone) => {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  } catch (_error) {
    return new Date().toISOString().slice(0, 10);
  }
};

const resolveOvertimeAlertLimitMinutes = (member) => {
  const fromUser = Number(member?.bankHoursLimitMinutes);
  if (Number.isFinite(fromUser) && fromUser > 0) {
    return Math.floor(fromUser);
  }

  return Math.floor(DEFAULT_OVERTIME_LIMIT_MINUTES);
};

const resolveEffectivePlan = (user) => {
  if (!user) {
    return {
      code: 'STARTER',
      status: 'INACTIVE',
    };
  }

  if (user.role === 'SUPERADMIN') {
    return {
      code: 'PRO',
      status: 'ACTIVE',
    };
  }

  if (user.role === 'ADMIN') {
    return {
      code: user.adminPlan?.code || 'STARTER',
      status: user.adminPlanStatus || 'INACTIVE',
    };
  }

  if (user.organizationAdmin) {
    return {
      code: user.organizationAdmin.adminPlan?.code || 'STARTER',
      status: user.organizationAdmin.adminPlanStatus || 'INACTIVE',
    };
  }

  return {
    code: 'STARTER',
    status: 'INACTIVE',
  };
};

const resolveAlertManager = (user) => {
  if (user.supervisor) {
    return {
      id: user.supervisor.id,
      name: user.supervisor.name,
      email: user.supervisor.email,
    };
  }

  if (user.organizationAdmin) {
    return {
      id: user.organizationAdmin.id,
      name: user.organizationAdmin.name,
      email: user.organizationAdmin.email,
    };
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
  };
};

const shouldAlertNearShiftEnd = (member) => {
  const endMinutes = parseTimeToMinutes(
    member.workdayEndTime || process.env.PROACTIVE_DEFAULT_WORKDAY_END_TIME || '18:00'
  );

  if (endMinutes === null) {
    return false;
  }

  const nowMinutes = getNowMinutesForTimeZone(member.timeZone);
  let minutesUntilEnd = endMinutes - nowMinutes;

  // Ajuste para janelas que cruzam meia-noite.
  if (minutesUntilEnd < -720) minutesUntilEnd += 1440;
  if (minutesUntilEnd > 720) minutesUntilEnd -= 1440;

  return (
    minutesUntilEnd <= PROACTIVE_END_SHIFT_WINDOW_MINUTES &&
    minutesUntilEnd >= -PROACTIVE_POST_SHIFT_GRACE_MINUTES
  );
};

const buildDispatchKey = ({ dateKey, managerId, memberId, thresholdPercent }) =>
  `proactive:overtime:${dateKey}:${managerId}:${memberId}:${thresholdPercent}`;

const resolveDispatchChannels = ({ managerEmail }) => {
  const channels =
    EXPLICIT_ALERT_CHANNELS.length > 0
      ? EXPLICIT_ALERT_CHANNELS
      : getEnabledOvertimeChannels();

  const withoutInvalid = channels.filter((channel) =>
    ['EMAIL', 'PUSH', 'IN_APP'].includes(channel)
  );

  return withoutInvalid.filter((channel) => channel !== 'EMAIL' || Boolean(managerEmail));
};

const processScanJob = async () => {
  const now = new Date();
  const utcStart = new Date(now);
  utcStart.setUTCHours(0, 0, 0, 0);

  const utcEnd = new Date(now);
  utcEnd.setUTCHours(23, 59, 59, 999);

  const openEntries = await prisma.timeEntry.findMany({
    where: {
      clockOut: null,
    },
    select: {
      id: true,
      userId: true,
      clockIn: true,
    },
  });

  if (openEntries.length === 0) {
    return {
      scanned: 0,
      enqueued: 0,
      skipped: 0,
    };
  }

  const userIds = Array.from(
    new Set(openEntries.map((entry) => entry.userId).filter(Boolean))
  );

  if (userIds.length === 0) {
    return {
      scanned: openEntries.length,
      enqueued: 0,
      skipped: openEntries.length,
    };
  }

  const users = await prisma.user.findMany({
    where: {
      id: { in: userIds },
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      timeZone: true,
      contractDailyMinutes: true,
      bankHoursLimitMinutes: true,
      workdayEndTime: true,
      adminPlanStatus: true,
      adminPlan: {
        select: {
          code: true,
        },
      },
      supervisor: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      organizationAdmin: {
        select: {
          id: true,
          name: true,
          email: true,
          adminPlanStatus: true,
          adminPlan: {
            select: {
              code: true,
            },
          },
        },
      },
    },
  });

  const usersById = new Map(users.map((user) => [user.id, user]));

  const closedEntriesToday = await prisma.timeEntry.findMany({
    where: {
      userId: { in: userIds },
      clockIn: {
        gte: utcStart,
        lte: utcEnd,
      },
      clockOut: {
        not: null,
      },
    },
    select: {
      userId: true,
      workedMinutes: true,
      clockIn: true,
      clockOut: true,
    },
  });

  const workedMinutesByUser = closedEntriesToday.reduce((acc, entry) => {
    const worked = Number(entry.workedMinutes);
    const value = Number.isFinite(worked) && worked > 0
      ? Math.floor(worked)
      : Math.max(0, Math.floor((new Date(entry.clockOut) - new Date(entry.clockIn)) / 60000));

    acc[entry.userId] = (acc[entry.userId] || 0) + value;
    return acc;
  }, {});

  let enqueued = 0;
  let skipped = 0;

  for (const openEntry of openEntries) {
    const member = usersById.get(openEntry.userId);
    if (!member) {
      skipped += 1;
      continue;
    }

    const plan = resolveEffectivePlan(member);

    if (!(plan.code === 'PRO' && plan.status === 'ACTIVE')) {
      skipped += 1;
      continue;
    }

    if (!shouldAlertNearShiftEnd(member)) {
      skipped += 1;
      continue;
    }

    const manager = resolveAlertManager(member);
    const elapsedMinutes = Math.max(0, Math.floor((now - new Date(openEntry.clockIn)) / 60000));
    const totalWorkedMinutesToday = (workedMinutesByUser[member.id] || 0) + elapsedMinutes;
    const contractDailyMinutes = Number(member.contractDailyMinutes || 480);
    const overtimeMinutesSoFar = Math.max(0, totalWorkedMinutesToday - contractDailyMinutes);
    const overtimeLimitMinutes = resolveOvertimeAlertLimitMinutes(member);
    const thresholdMinutes = Math.ceil((overtimeLimitMinutes * OVERTIME_ALERT_THRESHOLD_PERCENT) / 100);

    if (thresholdMinutes <= 0 || overtimeMinutesSoFar < thresholdMinutes) {
      skipped += 1;
      continue;
    }

    const dateKey = getDateKeyForTimeZone(member.timeZone);
    const dedupeKey = buildDispatchKey({
      dateKey,
      managerId: manager.id,
      memberId: member.id,
      thresholdPercent: OVERTIME_ALERT_THRESHOLD_PERCENT,
    });

    const shouldDispatch = await redis.set(dedupeKey, '1', 'EX', 60 * 60 * 36, 'NX');
    if (!shouldDispatch) {
      skipped += 1;
      continue;
    }

    const channels = resolveDispatchChannels({ managerEmail: manager.email });
    if (channels.length === 0) {
      skipped += 1;
      await redis.del(dedupeKey);
      continue;
    }

    const alertPayload = {
      type: 'OVERTIME_LIMIT_THRESHOLD',
      thresholdPercent: OVERTIME_ALERT_THRESHOLD_PERCENT,
      thresholdMinutes,
      overtimeMinutes: overtimeMinutesSoFar,
      overtimeLimitMinutes,
      dateKey,
      member: {
        id: member.id,
        name: member.name,
        email: member.email,
      },
      manager,
      channels,
      triggeredAt: new Date().toISOString(),
    };

    try {
      await proactiveAlertQueue.add(
        DISPATCH_JOB_NAME,
        {
          dedupeKey,
          alertPayload,
        },
        {
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 15000,
          },
          removeOnComplete: {
            age: 24 * 3600,
            count: 1000,
          },
          removeOnFail: {
            age: 7 * 24 * 3600,
          },
        }
      );
      enqueued += 1;
    } catch (queueError) {
      await redis.del(dedupeKey);
      throw queueError;
    }
  }

  return {
    scanned: openEntries.length,
    enqueued,
    skipped,
  };
};

const processDispatchJob = async (job) => {
  const { alertPayload, dedupeKey } = job.data || {};

  if (!alertPayload) {
    throw new Error('Payload do alerta ausente no job de dispatch.');
  }

  try {
    const result = await sendOvertimeThresholdNotification(alertPayload, {
      strict: true,
    });

    return {
      delivered: true,
      sentAt: result.sentAt,
      channels: result.channels,
      results: result.results,
    };
  } catch (error) {
    if (dedupeKey) {
      await redis.del(dedupeKey);
    }

    throw error;
  }
};

const createProactiveAlertWorker = async () => {
  await proactiveAlertQueue.add(
    SCAN_JOB_NAME,
    {},
    {
      jobId: SCAN_REPEAT_JOB_ID,
      repeat: {
        every: PROACTIVE_SCAN_INTERVAL_MS,
      },
      removeOnComplete: true,
      removeOnFail: true,
    }
  );

  const worker = new Worker(
    'proactive-overtime-alerts',
    async (job) => {
      if (job.name === SCAN_JOB_NAME) {
        return processScanJob();
      }

      if (job.name === DISPATCH_JOB_NAME) {
        return processDispatchJob(job);
      }

      return null;
    },
    {
      connection: redis,
      concurrency: 3,
    }
  );

  worker.on('completed', (job, result) => {
    if (job.name === SCAN_JOB_NAME) {
      console.log(
        `🔔 Proactive scan concluído (scanned=${result?.scanned || 0}, enqueued=${result?.enqueued || 0})`
      );
      return;
    }

    console.log(`✅ Proactive alert job ${job.id} concluído.`);
  });

  worker.on('failed', (job, err) => {
    console.error(`❌ Proactive alert job ${job?.id} falhou:`, err.message);
  });

  return worker;
};

module.exports = {
  proactiveAlertQueue,
  createProactiveAlertWorker,
};
