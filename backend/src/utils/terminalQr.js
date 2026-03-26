const crypto = require('crypto');
const redis = require('../config/redis');

const TOKEN_TTL_DAYS = Math.max(1, Number(process.env.TERMINAL_QR_TTL_DAYS || 30));
const TOKEN_TTL_SECONDS = Math.max(
  5,
  Number(process.env.TERMINAL_QR_TTL_SECONDS || TOKEN_TTL_DAYS * 24 * 60 * 60)
);
const TOKEN_SINGLE_USE = /^(1|true|yes|on)$/i.test(String(process.env.TERMINAL_QR_SINGLE_USE || 'false'));
const SIGNING_KEY = process.env.TERMINAL_QR_SIGNING_KEY || process.env.JWT_SECRET || 'terminal-qr-dev-key';

const consumedFallback = new Map();

const parseRegistry = () => {
  const raw = process.env.TERMINAL_REGISTRY_JSON;
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => ({
        id: String(item?.id || '').trim(),
        name: String(item?.name || '').trim() || null,
        branch: String(item?.branch || '').trim() || 'N/A',
        secret: String(item?.secret || '').trim() || null,
      }))
      .filter((item) => item.id);
  } catch (_error) {
    return [];
  }
};

const terminalRegistry = parseRegistry();

const toBase64Url = (value) =>
  Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

const fromBase64Url = (value) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf-8');
};

const signPayload = (payloadEncoded) =>
  toBase64Url(crypto.createHmac('sha256', SIGNING_KEY).update(payloadEncoded).digest());

const findTerminal = ({ terminalId }) =>
  terminalRegistry.find((terminal) => terminal.id === String(terminalId || '').trim()) || null;

const issueTerminalQrToken = ({ terminalId }) => {
  const terminal = findTerminal({ terminalId });
  if (!terminal) {
    return { ok: false, reason: 'TERMINAL_NOT_FOUND' };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    sub: 'terminal-qr',
    jti: crypto.randomUUID(),
    terminalId: terminal.id,
    branch: terminal.branch,
    terminalName: terminal.name,
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_TTL_SECONDS,
    singleUse: TOKEN_SINGLE_USE,
  };

  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);

  return {
    ok: true,
    token: `${encodedPayload}.${signature}`,
    terminal: {
      id: terminal.id,
      name: terminal.name,
      branch: terminal.branch,
    },
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    ttlSeconds: TOKEN_TTL_SECONDS,
    singleUse: TOKEN_SINGLE_USE,
  };
};

const verifyTerminalCredentials = ({ terminalId, terminalSecret }) => {
  const terminal = findTerminal({ terminalId });
  if (!terminal) return { ok: false, reason: 'TERMINAL_NOT_FOUND' };

  const secret = String(terminalSecret || '').trim();
  if (!secret) return { ok: false, reason: 'MISSING_TERMINAL_SECRET' };

  if (secret !== terminal.secret) return { ok: false, reason: 'INVALID_TERMINAL_SECRET' };

  return {
    ok: true,
    terminal: {
      id: terminal.id,
      name: terminal.name,
      branch: terminal.branch,
    },
  };
};

const consumeReplayKey = async ({ replayKey, ttlSeconds }) => {
  try {
    const result = await redis.set(replayKey, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  } catch (_error) {
    const now = Date.now();
    const expiresAt = consumedFallback.get(replayKey);
    if (expiresAt && expiresAt > now) {
      return false;
    }
    consumedFallback.set(replayKey, now + ttlSeconds * 1000);
    return true;
  }
};

const consumeTerminalQrToken = async ({ token }) => {
  const safeToken = String(token || '').trim();
  if (!safeToken) {
    return { ok: false, reason: 'MISSING_QR_TOKEN' };
  }

  const [encodedPayload, signature] = safeToken.split('.');
  if (!encodedPayload || !signature) {
    return { ok: false, reason: 'INVALID_QR_TOKEN' };
  }

  const expectedSignature = signPayload(encodedPayload);
  if (signature !== expectedSignature) {
    return { ok: false, reason: 'INVALID_QR_SIGNATURE' };
  }

  let payload = null;
  try {
    payload = JSON.parse(fromBase64Url(encodedPayload));
  } catch (_error) {
    return { ok: false, reason: 'INVALID_QR_PAYLOAD' };
  }

  if (!payload?.jti || !payload?.terminalId || !payload?.exp) {
    return { ok: false, reason: 'INVALID_QR_CLAIMS' };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds >= Number(payload.exp)) {
    return { ok: false, reason: 'QR_TOKEN_EXPIRED' };
  }

  const tokenSingleUse = Boolean(payload.singleUse);

  if (tokenSingleUse) {
    const replayKey = `terminal-qr:consumed:${payload.jti}`;
    const ttlSeconds = Math.max(1, Number(payload.exp) - nowSeconds);
    const consumed = await consumeReplayKey({ replayKey, ttlSeconds });

    if (!consumed) {
      return { ok: false, reason: 'QR_TOKEN_ALREADY_USED' };
    }
  }

  return {
    ok: true,
    tokenId: payload.jti,
    terminal: {
      id: payload.terminalId,
      name: payload.terminalName || null,
      branch: payload.branch || 'N/A',
    },
    expiresAt: new Date(Number(payload.exp) * 1000).toISOString(),
    singleUse: tokenSingleUse,
  };
};

module.exports = {
  verifyTerminalCredentials,
  issueTerminalQrToken,
  consumeTerminalQrToken,
};
