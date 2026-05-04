const nodemailer = require('nodemailer');

let cachedTransporter = null;

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const createEmailTransporter = () => {
  if (cachedTransporter) return cachedTransporter;

  const smtpUrl = process.env.SMTP_URL;
  if (smtpUrl) {
    cachedTransporter = nodemailer.createTransport(smtpUrl);
    return cachedTransporter;
  }

  const smtpHost = process.env.SMTP_HOST;
  if (!smtpHost) return null;

  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  cachedTransporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
  });

  return cachedTransporter;
};

const isEmailConfigured = () => Boolean(process.env.SMTP_URL || process.env.SMTP_HOST);

const isPushConfigured = () => Boolean(process.env.PUSH_WEBHOOK_URL);

const isEmailEnabled = () =>
  parseBoolean(process.env.OVERTIME_ALERT_EMAIL_ENABLED, isEmailConfigured());

const isPushEnabled = () =>
  parseBoolean(process.env.OVERTIME_ALERT_PUSH_ENABLED, isPushConfigured());

const getEnabledOvertimeChannels = () => {
  const channels = [];
  if (isEmailEnabled()) channels.push('EMAIL');
  if (isPushEnabled()) channels.push('PUSH');
  return channels;
};

const sendEmail = async ({ to, subject, text }) => {
  const emailEnabled = isEmailEnabled();
  if (!emailEnabled) {
    return { channel: 'EMAIL', delivered: false, reason: 'DISABLED' };
  }

  if (!to) {
    return { channel: 'EMAIL', delivered: false, reason: 'MISSING_RECIPIENT' };
  }

  const transporter = createEmailTransporter();
  if (!transporter) {
    console.warn(`📧 [OvertimeAlert] SMTP não configurado. To: ${to} | Subject: ${subject}`);
    return { channel: 'EMAIL', delivered: false, reason: 'SMTP_NOT_CONFIGURED' };
  }

  const from = process.env.NOTIFICATION_FROM_EMAIL || process.env.SMTP_FROM || 'no-reply@omnipunt.com';

  await transporter.sendMail({
    from,
    to,
    subject,
    text,
  });

  return { channel: 'EMAIL', delivered: true };
};

const sendPush = async ({ payload }) => {
  const pushEnabled = isPushEnabled();
  if (!pushEnabled) {
    return { channel: 'PUSH', delivered: false, reason: 'DISABLED' };
  }

  const pushWebhookUrl = process.env.PUSH_WEBHOOK_URL;
  if (!pushWebhookUrl) {
    console.warn('📲 [OvertimeAlert] PUSH habilitado sem PUSH_WEBHOOK_URL configurada.');
    return { channel: 'PUSH', delivered: false, reason: 'MISSING_WEBHOOK' };
  }

  const response = await fetch(pushWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Falha no push webhook: HTTP ${response.status}`);
  }

  return { channel: 'PUSH', delivered: true };
};

const sendOvertimeThresholdNotification = async (alert, options = {}) => {
  const strictMode = Boolean(options.strict);
  const fallbackChannels = getEnabledOvertimeChannels();
  const channels = Array.isArray(alert?.channels) && alert.channels.length > 0
    ? alert.channels
    : fallbackChannels;

  const summaryText = [
    `Colaborador: ${alert.member.name} (${alert.member.email})`,
    `HE no dia: ${alert.overtimeMinutes} min`,
    `Limite configurado: ${alert.overtimeLimitMinutes} min`,
    `Limiar de alerta: ${alert.thresholdPercent}% (${alert.thresholdMinutes} min)`,
    `Data: ${alert.dateKey}`,
  ].join('\n');

  const subject = `[SystemaPonto] Alerta de HE ${alert.thresholdPercent}% - ${alert.member.name}`;

  const results = [];

  if (channels.includes('EMAIL')) {
    try {
      results.push(
        await sendEmail({
          to: alert.manager?.email || null,
          subject,
          text: summaryText,
        })
      );
    } catch (error) {
      results.push({
        channel: 'EMAIL',
        delivered: false,
        reason: 'ERROR',
        details: error.message,
      });
    }
  }

  if (channels.includes('PUSH')) {
    try {
      results.push(
        await sendPush({
          payload: {
            type: 'OVERTIME_LIMIT_THRESHOLD',
            manager: alert.manager,
            member: alert.member,
            thresholdPercent: alert.thresholdPercent,
            thresholdMinutes: alert.thresholdMinutes,
            overtimeMinutes: alert.overtimeMinutes,
            overtimeLimitMinutes: alert.overtimeLimitMinutes,
            dateKey: alert.dateKey,
            triggeredAt: alert.triggeredAt,
          },
        })
      );
    } catch (error) {
      results.push({
        channel: 'PUSH',
        delivered: false,
        reason: 'ERROR',
        details: error.message,
      });
    }
  }

  if (strictMode) {
    const failedChannels = results.filter((result) => !result.delivered);
    if (failedChannels.length > 0) {
      const details = failedChannels
        .map((result) => `${result.channel}:${result.reason || 'UNKNOWN'}`)
        .join(', ');
      throw new Error(`Falha no envio de alerta proativo: ${details}`);
    }
  }

  return {
    sentAt: new Date().toISOString(),
    channels,
    results,
  };
};

module.exports = {
  sendOvertimeThresholdNotification,
  getEnabledOvertimeChannels,
};
