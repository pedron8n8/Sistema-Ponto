const crypto = require('crypto');

const INVITABLE_ROLES = ['HR', 'SUPERVISOR', 'MEMBER'];
const DEFAULT_TTL_HOURS = Math.max(1, Number(process.env.TEAM_INVITE_DEFAULT_TTL_HOURS || 72));
const MAX_TTL_HOURS = Math.max(DEFAULT_TTL_HOURS, Number(process.env.TEAM_INVITE_MAX_TTL_HOURS || 720));

const ensureInviteSecret = () => {
  const secret = String(
    process.env.TEAM_INVITE_HMAC_SECRET || process.env.JWT_SECRET || ''
  ).trim();

  if (!secret || secret.length < 16) {
    throw new Error('TEAM_INVITE_HMAC_SECRET nao configurado (minimo 16 caracteres).');
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
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const normalizeInvitedRole = (role) => String(role || '').trim().toUpperCase();

const resolveTtlHours = (expiresInHours) => {
  const parsed = Number(expiresInHours);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TTL_HOURS;
  }

  return Math.min(Math.floor(parsed), MAX_TTL_HOURS);
};

const issueTeamInviteToken = ({ adminId, role, issuedById, expiresInHours }) => {
  const secret = ensureInviteSecret();
  const normalizedAdminId = String(adminId || '').trim();
  const normalizedRole = normalizeInvitedRole(role);

  if (!normalizedAdminId) {
    throw new Error('adminId e obrigatorio para emitir convite.');
  }

  if (!INVITABLE_ROLES.includes(normalizedRole)) {
    throw new Error(`role invalida. Valores aceitos: ${INVITABLE_ROLES.join(', ')}`);
  }

  const ttlHours = resolveTtlHours(expiresInHours);
  const nowMs = Date.now();
  const expiresAtMs = nowMs + ttlHours * 60 * 60 * 1000;

  const payload = {
    type: 'team_invite',
    adminId: normalizedAdminId,
    role: normalizedRole,
    issuedById: String(issuedById || normalizedAdminId),
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

const verifyTeamInviteToken = (token) => {
  const secret = ensureInviteSecret();
  const rawToken = String(token || '').trim();

  if (!rawToken) {
    throw new Error('Token de convite ausente.');
  }

  const [payloadSegment, signature] = rawToken.split('.');
  if (!payloadSegment || !signature) {
    throw new Error('Formato de token de convite invalido.');
  }

  const expectedSignature = signSegment(payloadSegment, secret);
  if (!secureEqual(signature, expectedSignature)) {
    throw new Error('Assinatura do token de convite invalida.');
  }

  let payload;
  try {
    payload = decodePayload(payloadSegment);
  } catch (_error) {
    throw new Error('Payload do token de convite invalido.');
  }

  if (payload.type !== 'team_invite') {
    throw new Error('Tipo de token de convite invalido.');
  }

  const adminId = String(payload.adminId || '').trim();
  const role = normalizeInvitedRole(payload.role);
  const expiresAtMs = Number(payload.exp);

  if (!adminId) {
    throw new Error('Token de convite sem adminId.');
  }

  if (!INVITABLE_ROLES.includes(role)) {
    throw new Error('Token de convite com role invalida.');
  }

  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) {
    throw new Error('Token de convite expirado.');
  }

  return {
    ...payload,
    adminId,
    role,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
};

module.exports = {
  INVITABLE_ROLES,
  issueTeamInviteToken,
  verifyTeamInviteToken,
};
