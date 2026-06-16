const { Queue, Worker } = require('bullmq');
const { prisma } = require('../config/database');
const redis = require('../config/redis');
const {
  sendOvertimeThresholdNotification,
  getEnabledOvertimeChannels,
} = require('../utils/notifications');
const { sendSlackDM } = require('../utils/slackNotifier');
const { sendResendEmail } = require('../utils/resendNotifier');

const SCAN_JOB_NAME = 'scan-end-of-shift-overtime';
const DISPATCH_JOB_NAME = 'dispatch-end-of-shift-overtime';
const DISPATCH_SHIFT_END_JOB_NAME = 'dispatch-shift-end-reminder';
const SCAN_CLOCK_IN_JOB_NAME = 'scan-clock-in-reminders';
const DISPATCH_CLOCK_IN_JOB_NAME = 'dispatch-clock-in-reminder';
const SCAN_REPEAT_JOB_ID = 'scan-end-of-shift-overtime-repeat';
const SCAN_CLOCK_IN_REPEAT_JOB_ID = 'scan-clock-in-reminders-repeat';

const SHIFT_END_DEDUPE_TTL_SECONDS = 60 * 60 * 18;
const CLOCK_IN_DEDUPE_TTL_SECONDS = 60 * 60 * 18;
const DEFAULT_BASE_TIMEZONE = process.env.PROACTIVE_CLOCK_IN_DEFAULT_TZ || 'America/Chicago';

const toPositiveNumber = (value, fallback, minimum = 1) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, parsed);
};

const SHIFT_END_PRE_MINUTES = toPositiveNumber(
  process.env.PROACTIVE_SHIFT_END_PRE_MINUTES,
  15,
  1
);
const SHIFT_END_OVERSHOOT_GRACE_MINUTES = toPositiveNumber(
  process.env.PROACTIVE_SHIFT_END_OVERSHOOT_GRACE_MINUTES,
  2,
  1
);

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

const CLOCK_IN_SCAN_INTERVAL_MS = toPositiveNumber(
  process.env.PROACTIVE_CLOCK_IN_SCAN_INTERVAL_MS,
  60000,
  30000
);
const CLOCK_IN_PRE_MINUTES = toPositiveNumber(
  process.env.PROACTIVE_CLOCK_IN_PRE_MINUTES,
  15,
  1
);
const CLOCK_IN_LATE_MINUTES = toPositiveNumber(
  process.env.PROACTIVE_CLOCK_IN_LATE_MINUTES,
  30,
  1
);
const CLOCK_IN_SKIP_WEEKENDS = String(process.env.PROACTIVE_CLOCK_IN_SKIP_WEEKENDS || 'true')
  .trim()
  .toLowerCase() !== 'false';

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
  // console.log('🔍 Worker DB URL:', process.env.DATABASE_URL);
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
      breakMinutes: true,
      breakStartedAt: true,
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
      slackUserId: true,
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
          slackUserId: true,
        },
      },
      organizationAdmin: {
        select: {
          id: true,
          name: true,
          email: true,
          slackUserId: true,
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

    let entryEnqueued = false;

    const overtimeOutcome = await evaluateOvertimeThreshold({
      openEntry,
      member,
      now,
      workedMinutesByUser,
    });
    if (overtimeOutcome === 'enqueued') {
      enqueued += 1;
      entryEnqueued = true;
    }

    const shiftEndOutcome = await evaluateShiftEndReminder({ openEntry, member, now });
    if (shiftEndOutcome === 'enqueued') {
      enqueued += 1;
      entryEnqueued = true;
    }

    if (!entryEnqueued) {
      skipped += 1;
    }
  }

  return {
    scanned: openEntries.length,
    enqueued,
    skipped,
  };
};

const evaluateOvertimeThreshold = async ({ openEntry, member, now, workedMinutesByUser }) => {
  const plan = resolveEffectivePlan(member);
  if (!(plan.code === 'PRO' && plan.status === 'ACTIVE')) {
    return 'skipped';
  }

  if (!shouldAlertNearShiftEnd(member)) {
    return 'skipped';
  }

  const manager = resolveAlertManager(member);
  const elapsedMinutes = Math.max(0, Math.floor((now - new Date(openEntry.clockIn)) / 60000));
  const totalWorkedMinutesToday = (workedMinutesByUser[member.id] || 0) + elapsedMinutes;
  const contractDailyMinutes = Number(member.contractDailyMinutes || 480);
  const overtimeMinutesSoFar = Math.max(0, totalWorkedMinutesToday - contractDailyMinutes);
  const overtimeLimitMinutes = resolveOvertimeAlertLimitMinutes(member);
  const thresholdMinutes = Math.ceil((overtimeLimitMinutes * OVERTIME_ALERT_THRESHOLD_PERCENT) / 100);

  if (thresholdMinutes <= 0 || overtimeMinutesSoFar < thresholdMinutes) {
    return 'skipped';
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
    return 'skipped';
  }

  const channels = resolveDispatchChannels({ managerEmail: manager.email });
  if (channels.length === 0) {
    await redis.del(dedupeKey);
    return 'skipped';
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
    return 'enqueued';
  } catch (queueError) {
    await redis.del(dedupeKey);
    throw queueError;
  }
};

const resolveSupervisorContact = (member) => {
  const supervisor = member?.supervisor || member?.organizationAdmin;
  if (!supervisor) return null;

  return {
    id: supervisor.id,
    name: supervisor.name,
    email: supervisor.email || null,
    slackUserId: supervisor.slackUserId || null,
  };
};

const resolveShiftEndSupervisor = (member) => resolveSupervisorContact(member);

const evaluateShiftEndReminder = async ({ openEntry, member, now }) => {
  if (!member.slackUserId) {
    return 'skipped';
  }

  const contractDailyMinutes = Number(member.contractDailyMinutes || 480);
  if (!Number.isFinite(contractDailyMinutes) || contractDailyMinutes <= 0) {
    return 'skipped';
  }

  const clockInDate = new Date(openEntry.clockIn);
  const elapsedMinutes = Math.max(0, Math.floor((now - clockInDate) / 60000));

  const storedBreakMinutes = Math.max(0, Math.floor(Number(openEntry.breakMinutes) || 0));
  const breakStartedAt = openEntry.breakStartedAt ? new Date(openEntry.breakStartedAt) : null;
  const ongoingBreakMinutes = breakStartedAt && Number.isFinite(breakStartedAt.getTime())
    ? Math.max(0, Math.floor((now - breakStartedAt) / 60000))
    : 0;
  const totalBreakMinutes = storedBreakMinutes + ongoingBreakMinutes;

  const workedMinutes = Math.max(0, elapsedMinutes - totalBreakMinutes);
  const remainingMinutes = contractDailyMinutes - workedMinutes;

  let phase = null;
  if (remainingMinutes <= 0 && remainingMinutes >= -SHIFT_END_OVERSHOOT_GRACE_MINUTES) {
    phase = 'END';
  } else if (remainingMinutes > 0 && remainingMinutes <= SHIFT_END_PRE_MINUTES) {
    phase = 'PRE_END';
  } else {
    return 'skipped';
  }

  const supervisor = resolveShiftEndSupervisor(member);

  const dedupeKey = `shift-end:${openEntry.id}:${phase}`;
  const shouldDispatch = await redis.set(dedupeKey, '1', 'EX', SHIFT_END_DEDUPE_TTL_SECONDS, 'NX');
  if (!shouldDispatch) {
    return 'skipped';
  }

  const expectedEndAt = new Date(
    clockInDate.getTime() + (contractDailyMinutes + totalBreakMinutes) * 60000
  ).toISOString();

  const payload = {
    type: 'SHIFT_END_REMINDER',
    phase,
    timeEntryId: openEntry.id,
    contractDailyMinutes,
    remainingMinutes,
    expectedEndAt,
    timeZone: member.timeZone || 'America/Chicago',
    member: {
      id: member.id,
      name: member.name,
      email: member.email,
      slackUserId: member.slackUserId,
    },
    supervisor,
    triggeredAt: new Date().toISOString(),
  };

  try {
    await proactiveAlertQueue.add(
      DISPATCH_SHIFT_END_JOB_NAME,
      {
        dedupeKey,
        payload,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 10000,
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
    return 'enqueued';
  } catch (queueError) {
    await redis.del(dedupeKey);
    throw queueError;
  }
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

const formatShiftEndTime = (isoString, timeZone) => {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'America/Chicago',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(isoString));
  } catch (_error) {
    return new Date(isoString).toISOString().slice(11, 16);
  }
};

const buildShiftEndUserMessage = ({ phase, expectedEndAt, timeZone, remainingMinutes }) => {
  const formattedEnd = formatShiftEndTime(expectedEndAt, timeZone);

  if (phase === 'PRE_END') {
    const minutesLeft = Math.max(1, remainingMinutes);
    return `:warning: *Heads up!* Your shift ends in ~${minutesLeft} min (around ${formattedEnd}).\nWrap up your tasks and clock out on time to avoid overtime.\nUse \`/omni finish <PIN>\` to clock out from Slack.`;
  }

  return `:bell: *Time to clock out!* Your scheduled end time is ${formattedEnd}.\nDon't forget to end your workday to avoid unwanted overtime.\nUse \`/omni finish <PIN>\` to clock out from Slack.`;
};

const buildShiftEndSupervisorMessage = ({ phase, memberName, expectedEndAt, timeZone, remainingMinutes }) => {
  const formattedEnd = formatShiftEndTime(expectedEndAt, timeZone);

  if (phase === 'PRE_END') {
    const minutesLeft = Math.max(1, remainingMinutes);
    return `:hourglass_flowing_sand: *${memberName}* is ${minutesLeft} min away from end of shift (${formattedEnd}). Heads-up sent to help avoid overtime.`;
  }

  return `:bell: *${memberName}* has reached the scheduled end of shift (${formattedEnd}) and is still clocked in. Reminder sent to clock out.`;
};

const buildShiftEndSupervisorEmail = ({ phase, memberName, expectedEndAt, timeZone, remainingMinutes }) => {
  const formattedEnd = formatShiftEndTime(expectedEndAt, timeZone);

  if (phase === 'PRE_END') {
    const minutesLeft = Math.max(1, remainingMinutes);
    return {
      subject: `[SystemaPonto] ${memberName} esta proximo do fim de turno`,
      text: `${memberName} esta a ~${minutesLeft} min do fim do turno (previsto para ${formattedEnd}). Um lembrete foi enviado para ajudar a evitar horas extras.`,
    };
  }

  return {
    subject: `[SystemaPonto] ${memberName} nao registrou saida`,
    text: `${memberName} atingiu o horario previsto de fim de turno (${formattedEnd}) e ainda esta com o ponto aberto. Um lembrete de saida foi enviado.`,
  };
};

const getWeekdayForTimeZone = (timeZone) => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || DEFAULT_BASE_TIMEZONE,
      weekday: 'short',
    }).formatToParts(new Date());
    return parts.find((p) => p.type === 'weekday')?.value || '';
  } catch (_error) {
    return '';
  }
};

const getLocalDayBoundsUtc = (timeZone) => {
  const tz = timeZone || DEFAULT_BASE_TIMEZONE;
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((p) => [p.type, p.value])
  );

  const localYear = Number(parts.year);
  const localMonth = Number(parts.month);
  const localDay = Number(parts.day);
  const localHour = Number(parts.hour === '24' ? '0' : parts.hour);
  const localMinute = Number(parts.minute);
  const localSecond = Number(parts.second);

  const asIfUtcLocal = Date.UTC(localYear, localMonth - 1, localDay, localHour, localMinute, localSecond);
  const offsetMs = asIfUtcLocal - now.getTime();

  const startUtc = new Date(Date.UTC(localYear, localMonth - 1, localDay) - offsetMs);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { startUtc, endUtc };
};

const processClockInScanJob = async () => {
  const candidates = await prisma.user.findMany({
    where: {
      isActive: true,
      slackUserId: { not: null },
      workdayStartTime: { not: null },
    },
    select: {
      id: true,
      name: true,
      email: true,
      slackUserId: true,
      timeZone: true,
      workdayStartTime: true,
      supervisor: {
        select: {
          id: true,
          name: true,
          email: true,
          slackUserId: true,
        },
      },
      organizationAdmin: {
        select: {
          id: true,
          name: true,
          email: true,
          slackUserId: true,
        },
      },
    },
  });

  if (candidates.length === 0) {
    return { scanned: 0, enqueued: 0, skipped: 0 };
  }

  let enqueued = 0;
  let skipped = 0;

  for (const member of candidates) {
    const outcome = await evaluateClockInReminder({ member });
    if (outcome === 'enqueued') enqueued += 1;
    else skipped += 1;
  }

  return { scanned: candidates.length, enqueued, skipped };
};

const evaluateClockInReminder = async ({ member }) => {
  const timeZone = member.timeZone || DEFAULT_BASE_TIMEZONE;

  if (CLOCK_IN_SKIP_WEEKENDS) {
    const weekday = getWeekdayForTimeZone(timeZone);
    if (weekday === 'Sat' || weekday === 'Sun') {
      return 'skipped';
    }
  }

  const shiftStartMinutes = parseTimeToMinutes(member.workdayStartTime);
  if (shiftStartMinutes === null) {
    return 'skipped';
  }

  const nowMinutes = getNowMinutesForTimeZone(timeZone);
  let minutesFromStart = nowMinutes - shiftStartMinutes;
  if (minutesFromStart < -720) minutesFromStart += 1440;
  if (minutesFromStart > 720) minutesFromStart -= 1440;

  let phase = null;
  if (minutesFromStart >= -CLOCK_IN_PRE_MINUTES && minutesFromStart < 0) {
    phase = 'PRE_START';
  } else if (minutesFromStart >= 0 && minutesFromStart <= CLOCK_IN_LATE_MINUTES) {
    phase = 'LATE';
  } else {
    return 'skipped';
  }

  const { startUtc, endUtc } = getLocalDayBoundsUtc(timeZone);
  const existingEntry = await prisma.timeEntry.findFirst({
    where: {
      userId: member.id,
      clockIn: { gte: startUtc, lte: endUtc },
    },
    select: { id: true },
  });

  if (existingEntry) {
    return 'skipped';
  }

  const dateKey = getDateKeyForTimeZone(timeZone);
  const dedupeKey = `clock-in:${dateKey}:${member.id}:${phase}`;
  const shouldDispatch = await redis.set(dedupeKey, '1', 'EX', CLOCK_IN_DEDUPE_TTL_SECONDS, 'NX');
  if (!shouldDispatch) {
    return 'skipped';
  }

  const payload = {
    type: 'CLOCK_IN_REMINDER',
    phase,
    minutesFromStart,
    workdayStartTime: member.workdayStartTime,
    timeZone,
    member: {
      id: member.id,
      name: member.name,
      email: member.email,
      slackUserId: member.slackUserId,
    },
    supervisor: resolveSupervisorContact(member),
    triggeredAt: new Date().toISOString(),
  };

  try {
    await proactiveAlertQueue.add(
      DISPATCH_CLOCK_IN_JOB_NAME,
      { dedupeKey, payload },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      }
    );
    return 'enqueued';
  } catch (queueError) {
    await redis.del(dedupeKey);
    throw queueError;
  }
};

const buildClockInMessage = ({ phase, workdayStartTime, minutesFromStart }) => {
  if (phase === 'PRE_START') {
    const minutesLeft = Math.max(1, -minutesFromStart);
    return `:alarm_clock: *Heads up!* Your shift starts in ~${minutesLeft} min (at ${workdayStartTime}).\nDon't forget to clock in. You can use \`/omni start <PIN>\` from Slack.`;
  }
  const minutesLate = Math.max(1, minutesFromStart);
  return `:rotating_light: *You haven't clocked in yet.* Your shift was scheduled to start at ${workdayStartTime} (you're ~${minutesLate} min late).\nPlease clock in now. You can use \`/omni start <PIN>\` from Slack.`;
};

const buildClockInSupervisorEmail = ({ phase, memberName, workdayStartTime, minutesFromStart }) => {
  if (phase === 'PRE_START') {
    const minutesLeft = Math.max(1, -minutesFromStart);
    return {
      subject: `[SystemaPonto] ${memberName} tem turno comecando em breve`,
      text: `${memberName} tem inicio de turno em ~${minutesLeft} min (as ${workdayStartTime}) e ainda nao registrou entrada. Um lembrete foi enviado.`,
    };
  }

  const minutesLate = Math.max(1, minutesFromStart);
  return {
    subject: `[SystemaPonto] ${memberName} nao registrou entrada`,
    text: `${memberName} ainda nao registrou entrada. O turno estava previsto para iniciar as ${workdayStartTime} (~${minutesLate} min de atraso). Um lembrete foi enviado.`,
  };
};

const processClockInDispatchJob = async (job) => {
  const { payload, dedupeKey } = job.data || {};

  if (!payload?.member?.slackUserId) {
    return { delivered: false, reason: 'MISSING_MEMBER_SLACK_ID' };
  }

  const text = buildClockInMessage({
    phase: payload.phase,
    workdayStartTime: payload.workdayStartTime,
    minutesFromStart: payload.minutesFromStart,
  });

  try {
    const result = await sendSlackDM({
      slackUserId: payload.member.slackUserId,
      text,
    });

    if (!result.delivered) {
      throw new Error(`Failed to deliver Slack DM for clock-in reminder: ${result.reason || 'UNKNOWN'}`);
    }

    const results = [{ target: 'member', ...result }];

    // Notifica o supervisor por e-mail (Resend), assim como na mensagem do Slack.
    if (payload.supervisor?.email) {
      const supervisorEmail = buildClockInSupervisorEmail({
        phase: payload.phase,
        memberName: payload.member.name || 'Colaborador',
        workdayStartTime: payload.workdayStartTime,
        minutesFromStart: payload.minutesFromStart,
      });

      const supervisorEmailResult = await sendResendEmail({
        to: payload.supervisor.email,
        subject: supervisorEmail.subject,
        text: supervisorEmail.text,
      });
      results.push({ target: 'supervisor-email', ...supervisorEmailResult });
    }

    return { delivered: true, sentAt: new Date().toISOString(), results };
  } catch (error) {
    if (dedupeKey) {
      await redis.del(dedupeKey);
    }
    throw error;
  }
};

const processShiftEndDispatchJob = async (job) => {
  const { payload, dedupeKey } = job.data || {};

  if (!payload?.member?.slackUserId) {
    return { delivered: false, reason: 'MISSING_MEMBER_SLACK_ID' };
  }

  const userText = buildShiftEndUserMessage({
    phase: payload.phase,
    expectedEndAt: payload.expectedEndAt,
    timeZone: payload.timeZone,
    remainingMinutes: payload.remainingMinutes,
  });

  const results = [];
  try {
    const userResult = await sendSlackDM({
      slackUserId: payload.member.slackUserId,
      text: userText,
    });
    results.push({ target: 'member', ...userResult });

    if (payload.supervisor?.slackUserId) {
      const supervisorText = buildShiftEndSupervisorMessage({
        phase: payload.phase,
        memberName: payload.member.name || 'Team member',
        expectedEndAt: payload.expectedEndAt,
        timeZone: payload.timeZone,
        remainingMinutes: payload.remainingMinutes,
      });

      const supervisorResult = await sendSlackDM({
        slackUserId: payload.supervisor.slackUserId,
        text: supervisorText,
      });
      results.push({ target: 'supervisor', ...supervisorResult });
    }

    // Notifica o supervisor por e-mail (Resend), assim como na mensagem do Slack.
    if (payload.supervisor?.email) {
      const supervisorEmail = buildShiftEndSupervisorEmail({
        phase: payload.phase,
        memberName: payload.member.name || 'Colaborador',
        expectedEndAt: payload.expectedEndAt,
        timeZone: payload.timeZone,
        remainingMinutes: payload.remainingMinutes,
      });

      const supervisorEmailResult = await sendResendEmail({
        to: payload.supervisor.email,
        subject: supervisorEmail.subject,
        text: supervisorEmail.text,
      });
      results.push({ target: 'supervisor-email', ...supervisorEmailResult });
    }

    const memberDelivered = results.find((r) => r.target === 'member')?.delivered;
    if (!memberDelivered) {
      throw new Error(`Falha ao enviar DM Slack ao membro: ${results.find((r) => r.target === 'member')?.reason || 'UNKNOWN'}`);
    }

    return {
      delivered: true,
      sentAt: new Date().toISOString(),
      results,
    };
  } catch (error) {
    if (dedupeKey) {
      await redis.del(dedupeKey);
    }
    throw error;
  }
};

const createProactiveAlertWorker = async () => {
  // ✅ Remove jobs repetidos órfãos de reinicializações anteriores
  await proactiveAlertQueue.upsertJobScheduler(
    SCAN_REPEAT_JOB_ID,         // ID único — garante que só existe 1
    {
      every: PROACTIVE_SCAN_INTERVAL_MS,
    },
    {
      name: SCAN_JOB_NAME,
      opts: {
        removeOnComplete: true,
        removeOnFail: true,
      },
    }
  );

  await proactiveAlertQueue.upsertJobScheduler(
    SCAN_CLOCK_IN_REPEAT_JOB_ID,
    {
      every: CLOCK_IN_SCAN_INTERVAL_MS,
    },
    {
      name: SCAN_CLOCK_IN_JOB_NAME,
      opts: {
        removeOnComplete: true,
        removeOnFail: true,
      },
    }
  );

  const worker = new Worker(
    'proactive-overtime-alerts',
    async (job) => {
      if (job.name === SCAN_JOB_NAME) return processScanJob();
      if (job.name === DISPATCH_JOB_NAME) return processDispatchJob(job);
      if (job.name === DISPATCH_SHIFT_END_JOB_NAME) return processShiftEndDispatchJob(job);
      if (job.name === SCAN_CLOCK_IN_JOB_NAME) return processClockInScanJob();
      if (job.name === DISPATCH_CLOCK_IN_JOB_NAME) return processClockInDispatchJob(job);
      return null;
    },
    {
      connection: redis,
      concurrency: 3,
    }
  );

    worker.on('completed', (job, result) => {
      if (job.name === SCAN_JOB_NAME) {
        if (result?.enqueued > 0) {
          console.log(`🔔 Proactive scan: ${result.enqueued} alertas enfileirados`);
        }
        return;
      }
      if (job.name === SCAN_CLOCK_IN_JOB_NAME) {
        if (result?.enqueued > 0) {
          console.log(`⏰ Clock-in scan: ${result.enqueued} reminders enqueued`);
        }
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
  processScanJob,
  processShiftEndDispatchJob,
  evaluateShiftEndReminder,
};
