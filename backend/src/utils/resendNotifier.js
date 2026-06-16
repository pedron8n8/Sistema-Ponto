const RESEND_SEND_URL = 'https://api.resend.com/emails';

const isResendConfigured = () => Boolean(process.env.RESEND_API_KEY);

const resolveFromAddress = () =>
  process.env.RESEND_FROM_EMAIL ||
  process.env.NOTIFICATION_FROM_EMAIL ||
  process.env.SMTP_FROM ||
  'no-reply@omnipunt.com';

const sendResendEmail = async ({ to, subject, text, html } = {}) => {
  if (!to) {
    return { delivered: false, reason: 'MISSING_RECIPIENT' };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { delivered: false, reason: 'RESEND_NOT_CONFIGURED' };
  }

  const payload = {
    from: resolveFromAddress(),
    to: Array.isArray(to) ? to : [to],
    subject: subject || '',
  };

  if (html) {
    payload.html = html;
  }
  if (text || !html) {
    payload.text = text || '';
  }

  try {
    const response = await fetch(RESEND_SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const details = await response.text().catch(() => '');
      return {
        delivered: false,
        reason: 'HTTP_ERROR',
        details: `HTTP ${response.status} ${details}`.trim(),
      };
    }

    const body = await response.json().catch(() => null);
    return { delivered: true, id: body?.id };
  } catch (error) {
    return { delivered: false, reason: 'ERROR', details: error.message };
  }
};

module.exports = {
  sendResendEmail,
  isResendConfigured,
};
