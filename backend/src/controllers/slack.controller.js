const crypto = require('crypto');
const { prisma } = require('../config/database');
const timeController = require('./time.controller');
const { isValidPinFormat } = require('../utils/pinAuth');

const SIGNATURE_VERSION = 'v0';
const MAX_TIMESTAMP_DRIFT_SEC = 60 * 5;

// --- Helpers ----------------------------------------------------------------

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
    console.error('Failed to send delayed Slack response:', error?.message || error);
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
        body: { error: 'Internal Server Error', message: error?.message || 'Internal error.' },
      });
    });
  });

// --- English message resolution --------------------------------------------
// The web UI relies on time.controller returning Portuguese
// (frontend/src/lib/api.ts:329), so Slack translates at this boundary instead
// of changing the API contract. Three layers: reason codes, PT string map,
// then a catch-all guard so an unmapped Portuguese message can never leak.

// Mirrors the proven chain in frontend/src/lib/api.ts:38 (resolveAuthFactorMessage).
const resolveAuthFailureMessage = (body) => {
  const pinAuth = body?.pinAuth || null;
  const faceAuth = body?.faceAuth || null;
  if (!pinAuth && !faceAuth) return null;

  const pinReason = pinAuth?.reason || null;
  const faceReason = faceAuth?.reason || null;
  const pinRequired = pinAuth?.required === true;
  const faceRequired = faceAuth?.required === true;

  if (pinReason === 'PIN_LOCKED') {
    return 'PIN temporarily locked due to too many incorrect attempts.';
  }
  if (faceReason === 'LIVENESS_FAILED') {
    return 'Face liveness check failed. Blink and move your head to validate your face.';
  }
  if (pinReason === 'PIN_NOT_CONFIGURED' && faceReason === 'FACIAL_NOT_CONFIGURED') {
    return 'You must have a PIN or face enrollment set up before recording time. Contact your administrator.';
  }
  if (pinReason === 'PIN_NOT_PROVIDED' && faceReason === 'FACE_NOT_PROVIDED') {
    return 'Enter your PIN or use face recognition to record your time.';
  }
  if (pinReason === 'PIN_NOT_MATCHED' && faceReason === 'FACE_NOT_PROVIDED') {
    return 'PIN incorrect. Try again or use face recognition.';
  }
  if (pinReason === 'PIN_NOT_PROVIDED' && faceReason === 'FACE_NOT_MATCHED') {
    return 'Face recognition failed. Try again or enter your PIN.';
  }
  if (pinReason === 'PIN_NOT_MATCHED' && faceReason === 'FACE_NOT_MATCHED') {
    return 'PIN and face recognition did not match. Try again.';
  }
  if (pinReason === 'PIN_NOT_PROVIDED' && !faceRequired) {
    return 'Enter your PIN to record your time.';
  }
  if (faceReason === 'FACE_NOT_PROVIDED' && !pinRequired) {
    return 'Use face recognition to record your time.';
  }
  if (pinReason === 'PIN_NOT_MATCHED' && !faceRequired) {
    return 'PIN incorrect. Try again.';
  }
  if (faceReason === 'FACE_NOT_MATCHED' && !pinRequired) {
    return 'Face recognition failed. Try again.';
  }

  return null;
};

// Keys from time.controller.js getQrErrorMessage + geofence reasons.
const REASON_MESSAGES = {
  MISSING_QR_TOKEN: 'This site requires the terminal QR code to record time.',
  INVALID_QR_TOKEN: 'Invalid QR token.',
  INVALID_QR_SIGNATURE: 'Invalid QR signature.',
  INVALID_QR_PAYLOAD: 'Invalid QR payload.',
  INVALID_QR_CLAIMS: 'QR is missing required fields.',
  QR_TOKEN_EXPIRED: 'QR expired. Generate a new code.',
  QR_TOKEN_ALREADY_USED: 'QR already used. Generate a new code.',
  LOCATION_REQUIRED: 'Location is required. Enable GPS and allow location access.',
  OUTSIDE_GEOFENCE: 'You are outside the allowed work area.',
};

// Portuguese messages that carry no reason code (time.controller.js).
const PT_TO_EN_RULES = [
  { pattern: /j[aá]\s+possui\s+um\s+ponto\s+aberto/i, replacement: 'You already have an open time entry. Clock out before starting a new one.' },
  { pattern: /n[aã]o\s+h[aá]\s+registro\s+de\s+ponto\s+aberto/i, replacement: 'No open time entry. Clock in first.' },
  { pattern: /j[aá]\s+existe\s+uma\s+pausa\s+em\s+andamento/i, replacement: 'A break is already in progress.' },
  { pattern: /nenhuma\s+pausa\s+ativa\s+para\s+retomar/i, replacement: 'No active break to resume.' },
  { pattern: /obrigat[óo]rio\s+ter\s+pin\s+ou\s+facial/i, replacement: 'You must have a PIN or face enrollment set up before recording time. Contact your administrator.' },
  { pattern: /prova\s+de\s+vida\s+facial\s+inv[aá]lida/i, replacement: 'Face liveness check failed. Blink and move your head to validate your face.' },
  { pattern: /dados\s+faciais\s+inv[aá]lidos/i, replacement: 'Invalid face data. Please capture again.' },
  { pattern: /pin\s+temporariamente\s+bloqueado/i, replacement: 'PIN temporarily locked due to too many incorrect attempts.' },
  { pattern: /registro\s+exige\s+qr\s+code/i, replacement: 'This site requires the terminal QR code to record time.' },
  { pattern: /geolocaliza(?:c|ç)[aã]o\s+obrigat[óo]ria/i, replacement: 'Location is required. Enable GPS and allow location access.' },
  { pattern: /fora\s+da\s+cerca\s+virtual/i, replacement: 'You are outside the allowed work area.' },
  { pattern: /erro\s+ao\s+(registrar|iniciar|encerrar)/i, replacement: 'Something went wrong. Please try again.' },
];

const LOOKS_PORTUGUESE =
  /[ãõáéíóúç]|\b(nao|n[aã]o|erro|falha|voce|voc[eê]|ponto|pausa|obrigat[óo]rio|inv[aá]lido|registro|jornada|colaborador|sucesso|tente|novamente)\b/i;

/**
 * Turn a time.controller error payload into English text for Slack.
 * Falls back to `fallback` whenever the result would still be Portuguese,
 * so unmapped messages degrade instead of leaking.
 */
const toEnglishMessage = (body, fallback) => {
  const authMessage = resolveAuthFailureMessage(body);
  if (authMessage) return authMessage;

  const byReason = body?.reason ? REASON_MESSAGES[body.reason] : null;
  if (byReason) return byReason;

  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message) return fallback;

  for (const rule of PT_TO_EN_RULES) {
    if (rule.pattern.test(message)) return rule.replacement;
  }

  return LOOKS_PORTUGUESE.test(message) ? fallback : message;
};

// --- Command Parser --------------------------------------------------------

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

  // help - no PIN needed
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

// --- User Resolution -------------------------------------------------------

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

// --- Mock Request Builder --------------------------------------------------

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

// --- Action Handlers -------------------------------------------------------

const handleStart = async (req, user, parsed) => {
  const controllerReq = buildControllerReq(req, user, {
    pin: parsed.pin,
    notes: parsed.notes ? `[Slack] ${parsed.notes}` : 'Slack',
  });
  const result = await runTimeController(timeController.clockIn, controllerReq);
  if (result.status < 300) {
    const entry = result.body?.timeEntry;
    const clockInTime = entry?.clockIn ? new Date(entry.clockIn).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—';
    return `:white_check_mark: *Workday started!*
:clock9: Clock-in: ${clockInTime}`;
  }
  return `:x: ${toEnglishMessage(result.body, 'Could not start the workday.')}`;
};

const handleFinish = async (req, user, parsed) => {
  const controllerReq = buildControllerReq(req, user, {
    pin: parsed.pin,
    notes: parsed.notes ? `[Slack] ${parsed.notes}` : 'Slack',
  });
  const result = await runTimeController(timeController.clockOut, controllerReq);
  if (result.status < 300) {
    const entry = result.body?.timeEntry;
    const duration = entry?.duration?.formatted || '—';
    const overtime = entry?.overtime?.overtimeMinutes || 0;
    let msg = `:white_check_mark: *Workday ended!*
:stopwatch: Duration: ${duration}`;
    if (overtime > 0) {
      msg += `
:warning: Overtime: ${overtime} min`;
    }
    return msg;
  }
  return `:x: ${toEnglishMessage(result.body, 'Could not end the workday.')}`;
};

const handleBreak = async (req, user, parsed) => {
  const controllerReq = buildControllerReq(req, user, { pin: parsed.pin });
  const result = await runTimeController(timeController.startBreak, controllerReq);
  if (result.status < 300) {
    return ':coffee: *Break started!* Enjoy your rest.';
  }
  return `:x: ${toEnglishMessage(result.body, 'Could not start the break.')}`;
};

const handleResume = async (req, user, parsed) => {
  const controllerReq = buildControllerReq(req, user, { pin: parsed.pin });
  const result = await runTimeController(timeController.resumeBreak, controllerReq);
  if (result.status < 300) {
    const breakMin = result.body?.entry?.breakMinutes || 0;
    return `:arrow_forward: *Break ended!* Total break: ${breakMin} min`;
  }
  return `:x: ${toEnglishMessage(result.body, 'Could not end the break.')}`;
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
    return `:calendar: *${label}* — No records found.`;
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
    return `${statusEmoji} #${i + 1}: ${clockIn} → ${clockOut} | ${worked} min worked${brk > 0 ? ` | ${brk} min break` : ''}`;
  });

  const totalH = Math.floor(totalWorkedMin / 60);
  const totalM = totalWorkedMin % 60;

  return `:calendar: *${label}* — ${entries.length} record(s)\n${lines.join('\n')}\n\n:bar_chart: *Total:* ${totalH}h ${totalM}min worked | ${totalBreakMin} min break`;
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

// --- Main Handler ----------------------------------------------------------

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
    return res.status(500).json(buildSlackResponse('Slack signing secret is not configured on the server.'));
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
        console.error('Slack command error:', error?.message || error);
        return sendDelayedSlackResponse(
          responseUrl,
          'Could not process the command. Please try again shortly.'
        );
      });

    return;
  }

  try {
    const message = await processOmniCommand({ req, payload, parsed, botToken });
    return res.status(200).json(buildSlackResponse(message));
  } catch (error) {
    console.error('Slack command error:', error?.message || error);
    return res.status(200).json(
      buildSlackResponse('Could not process the command. Please try again shortly.')
    );
  }
};

module.exports = {
  handleSlackCommand,
  toEnglishMessage,
  LOOKS_PORTUGUESE,
};
