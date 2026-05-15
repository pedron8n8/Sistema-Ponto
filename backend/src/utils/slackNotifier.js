const SLACK_POST_MESSAGE_URL = 'https://slack.com/api/chat.postMessage';

const isSlackBotConfigured = () => Boolean(process.env.SLACK_BOT_TOKEN);

const sendSlackDM = async ({ slackUserId, text, blocks } = {}) => {
  if (!slackUserId) {
    return { delivered: false, reason: 'MISSING_SLACK_USER_ID' };
  }

  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    return { delivered: false, reason: 'SLACK_BOT_NOT_CONFIGURED' };
  }

  const payload = {
    channel: slackUserId,
    text: text || '',
  };

  if (Array.isArray(blocks) && blocks.length > 0) {
    payload.blocks = blocks;
  }

  const response = await fetch(SLACK_POST_MESSAGE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${botToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return {
      delivered: false,
      reason: 'HTTP_ERROR',
      details: `HTTP ${response.status}`,
    };
  }

  const body = await response.json().catch(() => null);

  if (!body?.ok) {
    return {
      delivered: false,
      reason: body?.error || 'UNKNOWN_SLACK_ERROR',
    };
  }

  return { delivered: true, ts: body.ts, channel: body.channel };
};

module.exports = {
  sendSlackDM,
  isSlackBotConfigured,
};
