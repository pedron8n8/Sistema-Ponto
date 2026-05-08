const crypto = require('crypto');
const { prisma } = require('../config/database');
const timeController = require('./time.controller');
const { isValidPinFormat } = require('../utils/pinAuth');

const SIGNATURE_VERSION = 'v0';
const MAX_TIMESTAMP_DRIFT_SEC = 60 * 5;

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

const parseSlackFormBody = (req) => {
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body.toString('utf8')
    : typeof req.body === 'string'
      ? req.body
      : '';

  const params = new URLSearchParams(rawBody);
  const payload = {};

  for (const [key, value] of params.entries()) {
    payload[key] = value;
  }

  return { rawBody, payload };
};

const timingSafeEqual = (a, b) => {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufferA, bufferB);
};

const verifySlackSignature = ({ rawBody, signature, timestamp, signingSecret }) => {
  if (!signature || !timestamp || !signingSecret) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_TIMESTAMP_DRIFT_SEC) return false;

  const base = `${SIGNATURE_VERSION}:${timestamp}:${rawBody}`;
  const digest = crypto
    .createHmac('sha256', signingSecret)
    .update(base, 'utf8')
    .digest('hex');

  const expected = `${SIGNATURE_VERSION}=${digest}`;
  return timingSafeEqual(expected, signature);
};

const fetchSlackUserEmail = async ({ slackUserId, botToken }) => {
  const response = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(slackUserId)}`, {
    headers: {
      Authorization: `Bearer ${botToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Slack API error: HTTP ${response.status}`);
  }

  const payload = await response.json();

  if (!payload?.ok) {
    const error = payload?.error ? String(payload.error) : 'unknown_error';
    throw new Error(`Slack API error: ${error}`);
  }

  return payload?.user?.profile?.email || null;
};

const buildSlackResponse = (text, extras = {}) => ({
  response_type: 'ephemeral',
  text,
  ...extras,
});

const buildSlackBlocks = (text, blocks) => ({
  response_type: 'ephemeral',
  text,
  blocks,
});

const sendDelayedSlackResponse = async (responseUrl, text) => {
  if (!responseUrl) return;

  try {
    const response = await fetch(responseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildSlackResponse(text, { replace_original: true })),
    });

    if (!response.ok) {
      console.error(`Slack delayed response failed: HTTP ${response.status}`);
    }
  } catch (error) {
    console.error('Erro ao enviar resposta assincrona ao Slack:', error?.message || error);
  }
};

const runTimeController = async (handler, req) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, body: payload });
      },
      send(payload) {
        resolve({ status: this.statusCode, body: payload });
      },
    };

    Promise.resolve(handler(req, res)).catch((error) => {
      resolve({
        status: 500,
        body: { error: 'Internal Server Error', message: error?.message || 'Erro interno' },
      });
    });
  });

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Command Parser Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

const ACTIONS = {
  start: new Set(['start', 'entrada', 'entrar', 'clock-in', 'in']),
  finish: new Set(['finish', 'saida', 'sair', 'clock-out', 'out', 'end', 'stop']),
  break: new Set(['break', 'pausa', 'pause']),
  resume: new Set(['resume', 'retomar', 'voltar', 'volta', 'unpause']),
  status: new Set(['status', 'estado', 'now']),
  info: new Set(['info', 'consulta', 'ver', 'view']),
  help: new Set(['help', 'ajuda', 'commands', 'comandos']),
};

const parseOmniCommand = (text) => {
  const trimmed = String(text || '').trim();
  if (!trimmed) return { ok: false, reason: 'EMPTY' };

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { ok: false, reason: 'EMPTY' };

  const first = parts[0].toLowerCase();

  // help Ã¢â‚¬â€ no PIN needed
  if (ACTIONS.help.has(first)) {
    return { ok: true, action: 'help', pin: null, args: [] };
  }

  // info today <PIN>  or  info MM/DD <PIN>
  if (ACTIONS.info.has(first)) {
    if (parts.length < 3) {
      return { ok: false, reason: 'MISSING_INFO_ARGS' };
    }
    const dateArg = parts[1].toLowerCase();
    const pin = parts[2];
    if (!isValidPinFormat(pin)) {
      return { ok: false, reason: 'INVALID_PIN' };
    }
    return { ok: true, action: 'info', pin, args: [dateArg] };
  }

  // start/finish/break/resume/status <PIN>
  for (const [action, aliases] of Object.entries(ACTIONS)) {
    if (action === 'help' || action === 'info') continue;
    if (aliases.has(first)) {
      const pin = parts[1];
      if (!pin || !isValidPinFormat(pin)) {
        return { ok: false, reason: 'INVALID_PIN' };
      }
      const notes = parts.slice(2).join(' ');
      return { ok: true, action, pin, args: [], notes };
    }
  }

  return { ok: false, reason: 'UNKNOWN_COMMAND' };
};

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ User Resolution Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

const resolveSlackUser = async ({ slackUserId, botToken }) => {
  // First, try by linked slackUserId
  let user = await prisma.user.findFirst({
    where: { slackUserId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
    },
  });

  if (user) return user;

  // Fallback: resolve email from Slack API
  if (botToken) {
    const email = await fetchSlackUserEmail({ slackUserId, botToken });
    if (email) {
      user = await prisma.user.findUnique({
        where: { email: String(email).trim().toLowerCase() },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
        },
      });
    }
  }

  return user || null;
};

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Mock Request Builder Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

/**
 * Build a fake Express-like request object so that time controller
 * helpers (captureRequestMetadata, etc.) don't crash.
 */
const buildControllerReq = (originalReq, user, body) => ({
  headers: {
    'x-forwarded-for': originalReq.headers?.['x-forwarded-for'] || '',
    'x-real-ip': originalReq.headers?.['x-real-ip'] || '',
    'user-agent': 'Slack Bot (OmniPunt)',
  },
  get(name) {
    return this.headers[name.toLowerCase()] || '';
  },
  connection: originalReq.connection || { remoteAddress: '127.0.0.1' },
  socket: originalReq.socket || { remoteAddress: '127.0.0.1' },
  body,
  user,
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Action Handlers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

const handleStart = async (req, user, parsed) => {
  const controllerReq = buildControllerReq(req, user, {
    pin: parsed.pin,
    notes: parsed.notes ? `[Slack] ${parsed.notes}` : 'Slack',
  });
  const result = await runTimeController(timeController.clockIn, controllerReq);
  if (result.status < 300) {
    const entry = result.body?.timeEntry;
    const clockInTime = entry?.clockIn ? new Date(entry.clockIn).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'Ã¢â‚¬â€';
    return `:white_check_mark: *Workday started!*
:clock9: Clock-in: ${clockInTime}`;
  }
  return `:x: ${result.body?.message || 'Could not start the workday.'}`;
};

const handleFinish = async (req, user, parsed) => {
  const controllerReq = buildControllerReq(req, user, {
    pin: parsed.pin,
    notes: parsed.notes ? `[Slack] ${parsed.notes}` : 'Slack',
  });
  const result = await runTimeController(timeController.clockOut, controllerReq);
  if (result.status < 300) {
    const entry = result.body?.timeEntry;
    const duration = entry?.duration?.formatted || 'Ã¢â‚¬â€';
    const overtime = entry?.overtime?.overtimeMinutes || 0;
    let msg = `:white_check_mark: *Workday ended!*
:stopwatch: Duration: ${duration}`;
    if (overtime > 0) {
      msg += `
:warning: Overtime: ${overtime} min`;
    }
    return msg;
  }
  return `:x: ${result.body?.message || 'Could not end the workday.'}`;
};

const handleBreak = async (req, user, parsed) => {
  const controllerReq = buildControllerReq(req, user, { pin: parsed.pin });
  const result = await runTimeController(timeController.startBreak, controllerReq);
  if (result.status < 300) {
    return ':coffee: *Break started!* Enjoy your rest.';
  }
  return `:x: ${result.body?.message || 'Could not start the break.'}`;
};

const handleResume = async (req, user, parsed) => {
  const controllerReq = buildControllerReq(req, user, { pin: parsed.pin });
  const result = await runTimeController(timeController.resumeBreak, controllerReq);
  if (result.status < 300) {
    const breakMin = result.body?.entry?.breakMinutes || 0;
    return `:arrow_forward: *Break ended!* Total break: ${breakMin} min`;
  }
  return `:x: ${result.body?.message || 'Could not end the break.'}`;
};

const handleStatus = async (user) => {
  const openEntry = await prisma.timeEntry.findFirst({
    where: { userId: user.id, clockOut: null },
    orderBy: { clockIn: 'desc' },
  });

  if (!openEntry) {
    return ':zzz: *No open workday.* Use `/omni start <PIN>` to begin.';
  }

  const clockInTime = new Date(openEntry.clockIn).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const now = new Date();
  const elapsedMs = now.getTime() - new Date(openEntry.clockIn).getTime();
  const elapsedMin = Math.floor(elapsedMs / 60000);
  const hours = Math.floor(elapsedMin / 60);
  const mins = elapsedMin % 60;

  let statusMsg = `:briefcase: *Workday in progress*
:clock9: Clock-in: ${clockInTime}
:stopwatch: Elapsed: ${hours}h ${mins}min`;

  if (openEntry.breakStartedAt) {
    const breakStart = new Date(openEntry.breakStartedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    statusMsg += `
:coffee: On break since: ${breakStart}`;
  } else {
    const storedBreak = openEntry.breakMinutes || 0;
    if (storedBreak > 0) {
      statusMsg += `
:coffee: Accumulated break: ${storedBreak} min`;
    }
  }

  return statusMsg;
};

const handleInfoToday = async (user) => {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  return buildInfoForDate(user, startOfDay, endOfDay, 'Today');
};

const handleInfoDate = async (user, dateArg) => {
  // Parse MM/DD format
  const match = dateArg.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) {
    return ':x: Invalid date format. Use `MM/DD` (e.g. `05/07`).';
  }

  const month = parseInt(match[1], 10) - 1;
  const day = parseInt(match[2], 10);
  const year = new Date().getFullYear();

  const target = new Date(year, month, day);
  if (Number.isNaN(target.getTime()) || target.getMonth() !== month || target.getDate() !== day) {
    return ':x: Invalid date. Use `MM/DD` (e.g. `05/07`).';
  }

  const startOfDay = new Date(year, month, day);
  const endOfDay = new Date(year, month, day, 23, 59, 59, 999);
  const label = `${String(month + 1).padStart(2, '0')}/${String(day).padStart(2, '0')}`;

  return buildInfoForDate(user, startOfDay, endOfDay, label);
};

const buildInfoForDate = async (user, startOfDay, endOfDay, label) => {
  const entries = await prisma.timeEntry.findMany({
    where: {
      userId: user.id,
      clockIn: { gte: startOfDay, lte: endOfDay },
    },
    orderBy: { clockIn: 'asc' },
  });

  if (entries.length === 0) {
    return `:calendar: *${label}* Ã¢â‚¬â€ No records found.`;
  }

  let totalWorkedMin = 0;
  let totalBreakMin = 0;
  const lines = entries.map((entry, i) => {
    const clockIn = new Date(entry.clockIn).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const clockOut = entry.clockOut
      ? new Date(entry.clockOut).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      : '_open_';
    const worked = entry.workedMinutes || 0;
    const brk = entry.breakMinutes || 0;
    totalWorkedMin += worked;
    totalBreakMin += brk;
    const statusEmoji = entry.status === 'APPROVED' ? ':white_check_mark:' : entry.status === 'REJECTED' ? ':no_entry:' : ':hourglass:';
    return `${statusEmoji} #${i + 1}: ${clockIn} Ã¢â€ â€™ ${clockOut} | ${worked} min worked${brk > 0 ? ` | ${brk} min break` : ''}`;
  });

  const totalH = Math.floor(totalWorkedMin / 60);
  const totalM = totalWorkedMin % 60;

  return `:calendar: *${label}* â€” ${entries.length} record(s)\n${lines.join('\n')}\n\n:bar_chart: *Total:* ${totalH}h ${totalM}min worked | ${totalBreakMin} min break`;
};

const handleHelp = () => {
  return [
    ':wave: *Available /omni commands*',
    '',
    '`/omni start <PIN>` - Start your workday',
    '`/omni finish <PIN>` - End your workday',
    '`/omni break <PIN>` - Start a break',
    '`/omni resume <PIN>` - Resume from break',
    '`/omni status <PIN>` - Check current status',
    '`/omni info today <PIN>` - Summary of today',
    '`/omni info MM/DD <PIN>` - Records for a date (e.g. `05/07`)',
    '`/omni help` - Show this message',
    '',
    ':key: PIN is required and ensures only you can operate your time clock.',
    ':link: Link your Slack account in your profile at omnipunt.com.',
  ].join('\n');
};

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Main Handler Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

const processOmniCommand = async ({ req, payload, parsed, botToken }) => {
  const slackUserId = payload.user_id;
  const user = await resolveSlackUser({ slackUserId, botToken });

  if (!user || user.isActive === false) {
    return ':warning: User not found or deactivated. Link your Slack account at omnipunt.com/app/perfil-completo.';
  }

  switch (parsed.action) {
    case 'start':
      return handleStart(req, user, parsed);
    case 'finish':
      return handleFinish(req, user, parsed);
    case 'break':
      return handleBreak(req, user, parsed);
    case 'resume':
      return handleResume(req, user, parsed);
    case 'status':
      return handleStatus(user);
    case 'info': {
      const dateArg = parsed.args[0];
      if (dateArg === 'today' || dateArg === 'hoje') {
        return handleInfoToday(user);
      }
      return handleInfoDate(user, dateArg);
    }
    default:
      return 'Unknown command. Use `/omni help`.';
  }
};
const handleSlackCommand = async (req, res) => {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const botToken = process.env.SLACK_BOT_TOKEN;

  if (!signingSecret) {
    return res.status(500).json(buildSlackResponse('Slack signing secret nao configurado no servidor.'));
  }

  const { rawBody, payload } = parseSlackFormBody(req);
  const signature = req.get('X-Slack-Signature');
  const timestamp = req.get('X-Slack-Request-Timestamp');

  if (!verifySlackSignature({ rawBody, signature, timestamp, signingSecret })) {
    return res.status(401).send('Invalid Slack signature');
  }

  const parsed = parseOmniCommand(payload.text || '');

  // Help needs no auth
  if (parsed.ok && parsed.action === 'help') {
    return res.status(200).json(buildSlackResponse(handleHelp()));
  }

  if (!parsed.ok) {
    const hints = {
      EMPTY: 'Use `/omni help` to see all available commands.',
      MISSING_INFO_ARGS: 'Usage: `/omni info today <PIN>` or `/omni info MM/DD <PIN>`',
      INVALID_PIN: 'Invalid PIN. PIN must be numeric (4-8 digits).',
      UNKNOWN_COMMAND: 'Unknown command. Use `/omni help` to see all commands.',
    };
    return res.status(200).json(buildSlackResponse(hints[parsed.reason] || 'Invalid command.'));
  }

  const responseUrl = payload.response_url;

  if (responseUrl) {
    res.status(200).json(buildSlackResponse(':hourglass_flowing_sand: Processing your /omni command...'));

    Promise.resolve()
      .then(() => processOmniCommand({ req, payload, parsed, botToken }))
      .then((message) => sendDelayedSlackResponse(responseUrl, message))
      .catch((error) => {
        console.error('Erro no Slack command:', error?.message || error);
        return sendDelayedSlackResponse(
          responseUrl,
          'Erro ao processar o comando. Tente novamente em instantes.'
        );
      });

    return;
  }

  try {
    const message = await processOmniCommand({ req, payload, parsed, botToken });
    return res.status(200).json(buildSlackResponse(message));
  } catch (error) {
    console.error('Erro no Slack command:', error?.message || error);
    return res.status(200).json(
      buildSlackResponse('Erro ao processar o comando. Tente novamente em instantes.')
    );
  }
};

module.exports = {
  handleSlackCommand,
};
