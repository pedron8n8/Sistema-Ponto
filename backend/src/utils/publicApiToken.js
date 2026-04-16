const crypto = require('crypto');
const { resolvePublicApiTokenTtlHours } = require('./proFeatureConfig');

const ensureSigningSecret = () => {
  const secret = String(process.env.PUBLIC_API_HMAC_SECRET || process.env.JWT_SECRET || '').trim();

  if (!secret || secret.length < 16) {
    throw new Error(
      'PUBLIC_API_HMAC_SECRET não configurado (mínimo de 16 caracteres).'
    );
  }

  return secret;
};

const encodePayload = (payload) =>
  Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

const decodePayload = (segment) => {
  const decoded = Buffer.from(segment, 'base64url').toString('utf8');
  return JSON.parse(decoded);
};

const signSegment = (segment, secret) =>
  crypto.createHmac('sha256', secret).update(segment).digest('base64url');

const secureEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const issuePublicApiToken = ({ adminId, issuedById, scopes = ['payroll:read'], expiresInHours }) => {
  const secret = ensureSigningSecret();

  if (!String(adminId || '').trim()) {
    throw new Error('adminId é obrigatório para gerar token da API pública.');
  }

  const ttlHours = resolvePublicApiTokenTtlHours(expiresInHours);
  const nowMs = Date.now();
  const expiresAtMs = nowMs + ttlHours * 60 * 60 * 1000;

  const payload = {
    sub: String(adminId),
    iss: String(issuedById || adminId),
    scopes: Array.isArray(scopes) && scopes.length > 0 ? scopes : ['payroll:read'],
    iat: nowMs,
    exp: expiresAtMs,
    jti: crypto.randomUUID(),
  };

  const payloadSegment = encodePayload(payload);
  const signature = signSegment(payloadSegment, secret);

  return {
    token: `${payloadSegment}.${signature}`,
    expiresAt: new Date(expiresAtMs).toISOString(),
    ttlHours,
    payload,
  };
};

const verifyPublicApiToken = (token) => {
  const secret = ensureSigningSecret();
  const rawToken = String(token || '').trim();

  if (!rawToken) {
    throw new Error('Token da API pública ausente.');
  }

  const [payloadSegment, signature] = rawToken.split('.');

  if (!payloadSegment || !signature) {
    throw new Error('Formato de token inválido.');
  }

  const expectedSignature = signSegment(payloadSegment, secret);
  if (!secureEqual(signature, expectedSignature)) {
    throw new Error('Assinatura do token inválida.');
  }

  let payload;
  try {
    payload = decodePayload(payloadSegment);
  } catch (_error) {
    throw new Error('Payload do token inválido.');
  }

  const expiresAt = Number(payload.exp);
  const adminId = String(payload.sub || '').trim();

  if (!adminId) {
    throw new Error('Token sem adminId.');
  }

  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    throw new Error('Token expirado.');
  }

  return {
    ...payload,
    adminId,
  };
};

const maskPublicApiToken = (token) => {
  const normalized = String(token || '').trim();
  if (!normalized) return '';

  if (normalized.length <= 12) {
    return `${normalized.slice(0, 3)}***`;
  }

  return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`;
};

module.exports = {
  issuePublicApiToken,
  verifyPublicApiToken,
  maskPublicApiToken,
};
