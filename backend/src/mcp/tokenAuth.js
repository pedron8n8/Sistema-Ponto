/**
 * Resolucao de tokens MCP contra o banco.
 *
 * Vive separado de oauthProvider.js de proposito: auth.middleware.js precisa
 * resolver um token MCP e nao deve arrastar o SDK do MCP (e o zod dele) para
 * dentro do caminho de autenticacao de toda requisicao da API.
 */

const crypto = require('crypto');
const { prisma } = require('../config/database');

// TTLs do fluxo OAuth. Ficam aqui, e nao em oauthProvider.js, para que o
// controller possa usa-los sem arrastar o SDK do MCP.
const AUTH_REQUEST_TTL_MS = 5 * 60 * 1000;
const CODE_TTL_MS = 60 * 1000;
const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Identidade canonica deste MCP server (o `resource` do RFC 8707). */
const resolveResourceUrl = () =>
  String(process.env.MCP_RESOURCE_URL || 'https://api.omnipunt.com/mcp').replace(/\/+$/, '');

const resolveFrontendUrl = () =>
  String(process.env.FRONTEND_URL || 'https://app.omnipunt.com').replace(/\/+$/, '');

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

const newSecret = () => crypto.randomBytes(32).toString('base64url');

/**
 * Busca um grant vivo: existe, e do tipo esperado, nao revogado e nao expirado.
 * O consumo unico do CODE (usedAt) e conferido por quem chama.
 */
const findLiveGrant = async (kind, secret) => {
  if (!secret) return null;
  // ponytail: todo segredo nosso vem de newSecret() -> base64url, sem ponto.
  // Um token com ponto e JWT do Supabase: sai antes de gastar uma query por
  // requisicao da API (e antes de explodir se a tabela nao existir).
  if (String(secret).includes('.')) return null;

  const grant = await prisma.mcpGrant.findUnique({
    where: { tokenHash: sha256(secret) },
    include: { connection: true },
  });

  if (!grant || grant.kind !== kind) return null;
  if (grant.revokedAt) return null;
  if (grant.expiresAt.getTime() <= Date.now()) return null;
  return grant;
};

/**
 * Resolve um bearer como access token MCP.
 *
 * Devolve null — sem lancar — quando nao e um token MCP, para que
 * auth.middleware.js possa seguir tentando o caminho do Supabase.
 *
 * @returns {Promise<null | {grantId: string, connectionId: string, userId: string, tools: string[], scopes: string[], connectionName: string}>}
 */
const resolveMcpAccessToken = async (token) => {
  const grant = await findLiveGrant('ACCESS', token);

  if (!grant) return null;
  if (!grant.connection || grant.connection.isActive === false) return null;
  if (!grant.connectionId || !grant.userId) return null;

  return {
    grantId: grant.id,
    connectionId: grant.connectionId,
    connectionName: grant.connection.name,
    userId: grant.userId,
    tools: grant.connection.tools,
    scopes: grant.scopes,
    clientId: grant.clientId,
  };
};

module.exports = {
  sha256,
  newSecret,
  findLiveGrant,
  resolveMcpAccessToken,
  resolveResourceUrl,
  resolveFrontendUrl,
  AUTH_REQUEST_TTL_MS,
  CODE_TTL_MS,
  ACCESS_TTL_MS,
  REFRESH_TTL_MS,
};
