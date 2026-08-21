/**
 * Authorization Server OAuth 2.1 para o MCP, sobre Prisma.
 *
 * Implementa a interface OAuthServerProvider do @modelcontextprotocol/sdk, que e
 * quem monta /authorize, /token, /register, /revoke e os documentos
 * /.well-known/*. Aqui ficam so as decisoes que sao nossas: onde guardar, quanto
 * dura, e para onde mandar o usuario consentir.
 *
 * Tokens sao opacos e guardados como sha256. Isso e de proposito: o token HMAC
 * stateless da API publica (utils/publicApiToken.js) nao pode ser revogado antes
 * de expirar, e revogacao imediata e justamente o que uma conexao de IA precisa.
 * Uma consulta Prisma por request e irrelevante ao lado da chamada de rede ao
 * Supabase que a API ja faz em todo request autenticado.
 */

const crypto = require('crypto');
const { prisma } = require('../config/database');
const {
  sha256,
  newSecret,
  findLiveGrant,
  resolveResourceUrl,
  resolveFrontendUrl,
  AUTH_REQUEST_TTL_MS,
  CODE_TTL_MS,
  ACCESS_TTL_MS,
  REFRESH_TTL_MS,
} = require('./tokenAuth');
const {
  InvalidGrantError,
  InvalidClientError,
  InvalidTokenError,
  InvalidTargetError,
  ServerError,
} = require('@modelcontextprotocol/sdk/server/auth/errors.js');

/**
 * Compara a `resource` do token com a identidade canonica deste MCP server.
 * O cliente pode mandar a URL completa do endpoint ou so a origem (RFC 8707
 * pede "a mais especifica que ele consiga"), entao aceitamos as duas.
 */
const isAcceptableResource = (value) => {
  if (!value) return true; // token emitido sem resource: nao ha audiencia a violar
  const canonical = resolveResourceUrl();
  const normalized = String(value).split('#')[0].replace(/\/+$/, '');
  if (normalized === canonical) return true;
  try {
    return normalized === new URL(canonical).origin;
  } catch (_error) {
    return false;
  }
};

// --- clients (Dynamic Client Registration, RFC 7591) ------------------------
const clientsStore = {
  async getClient(clientId) {
    const row = await prisma.mcpOAuthClient.findUnique({ where: { clientId } });
    if (!row) return undefined;
    return { ...row.metadata, client_id: row.clientId };
  },

  async registerClient(metadata) {
    const clientId = crypto.randomUUID();
    const isPublicClient = metadata.token_endpoint_auth_method === 'none';
    const clientSecret = isPublicClient ? undefined : newSecret();

    const stored = {
      ...metadata,
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    };

    await prisma.mcpOAuthClient.create({
      data: {
        clientId,
        metadata: stored,
        secretHash: clientSecret ? sha256(clientSecret) : null,
      },
    });

    return stored;
  },
};

// --- helpers de grant -------------------------------------------------------
const issueTokenPair = async ({ grant, scopes }) => {
  const accessToken = newSecret();
  const refreshToken = newSecret();
  const expiresAt = new Date(Date.now() + ACCESS_TTL_MS);

  const base = {
    clientId: grant.clientId,
    connectionId: grant.connectionId,
    userId: grant.userId,
    scopes,
    resource: grant.resource,
  };

  await prisma.mcpGrant.createMany({
    data: [
      { ...base, kind: 'ACCESS', tokenHash: sha256(accessToken), expiresAt },
      {
        ...base,
        kind: 'REFRESH',
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    ],
  });

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope: scopes.join(' '),
  };
};

const provider = {
  clientsStore,

  // Nos somos o AS: o SDK valida PKCE localmente contra
  // challengeForAuthorizationCode.
  skipLocalPkceValidation: false,

  /**
   * Nao emitimos o code aqui. Guardamos o pedido e mandamos o navegador para a
   * pagina de consentimento do painel, onde a pessoa faz login no Supabase e
   * escolhe QUAL conexao MCP autorizar. Quem fecha o ciclo e
   * POST /api/v1/mcp/oauth/authorize (mcp.controller.js).
   */
  async authorize(client, params, res) {
    const requestId = crypto.randomUUID();

    await prisma.mcpGrant.create({
      data: {
        kind: 'AUTH_REQUEST',
        tokenHash: sha256(requestId),
        clientId: client.client_id,
        scopes: Array.isArray(params.scopes) ? params.scopes : [],
        resource: params.resource ? String(params.resource) : null,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        state: params.state || null,
        expiresAt: new Date(Date.now() + AUTH_REQUEST_TTL_MS),
      },
    });

    res.redirect(`${resolveFrontendUrl()}/oauth/authorize?request_id=${requestId}`);
  },

  async challengeForAuthorizationCode(client, authorizationCode) {
    const grant = await findLiveGrant('CODE', authorizationCode);

    if (!grant || grant.clientId !== client.client_id || grant.usedAt) {
      throw new InvalidGrantError('Codigo de autorizacao invalido ou expirado.');
    }
    if (!grant.codeChallenge) {
      throw new ServerError('Codigo de autorizacao sem PKCE challenge.');
    }

    return grant.codeChallenge;
  },

  async exchangeAuthorizationCode(client, authorizationCode, _codeVerifier, redirectUri, resource) {
    const grant = await findLiveGrant('CODE', authorizationCode);

    if (!grant || grant.clientId !== client.client_id) {
      throw new InvalidGrantError('Codigo de autorizacao invalido ou expirado.');
    }
    if (grant.usedAt) {
      throw new InvalidGrantError('Codigo de autorizacao ja utilizado.');
    }
    if (redirectUri && grant.redirectUri && redirectUri !== grant.redirectUri) {
      throw new InvalidGrantError('redirect_uri diferente do usado na autorizacao.');
    }
    if (resource && grant.resource && String(resource) !== grant.resource) {
      throw new InvalidTargetError('resource diferente do usado na autorizacao.');
    }
    if (!grant.connection || grant.connection.isActive === false) {
      throw new InvalidGrantError('A conexao MCP autorizada foi desativada ou removida.');
    }

    // Uso unico: marca ANTES de emitir, condicionado a ainda estar nao-usado,
    // para que dois resgates concorrentes do mesmo code nao gerem dois tokens.
    const claimed = await prisma.mcpGrant.updateMany({
      where: { id: grant.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    if (claimed.count !== 1) {
      throw new InvalidGrantError('Codigo de autorizacao ja utilizado.');
    }

    return issueTokenPair({ grant, scopes: grant.scopes });
  },

  async exchangeRefreshToken(client, refreshToken, scopes, resource) {
    const grant = await findLiveGrant('REFRESH', refreshToken);

    if (!grant || grant.clientId !== client.client_id) {
      throw new InvalidGrantError('Refresh token invalido ou expirado.');
    }
    if (!grant.connection || grant.connection.isActive === false) {
      throw new InvalidGrantError('A conexao MCP autorizada foi desativada ou removida.');
    }
    if (resource && grant.resource && String(resource) !== grant.resource) {
      throw new InvalidTargetError('resource diferente do usado na autorizacao.');
    }

    // Um pedido de escopo no refresh so pode reduzir, nunca ampliar.
    const requested = Array.isArray(scopes) && scopes.length > 0 ? scopes : grant.scopes;
    const granted = requested.filter((scope) => grant.scopes.includes(scope));

    // Rotacao: o refresh usado morre junto com o access antigo do mesmo par.
    await prisma.mcpGrant.update({
      where: { id: grant.id },
      data: { revokedAt: new Date() },
    });

    return issueTokenPair({ grant, scopes: granted });
  },

  async verifyAccessToken(token) {
    const grant = await findLiveGrant('ACCESS', token);

    if (!grant) {
      throw new InvalidTokenError('Token de acesso invalido ou expirado.');
    }
    if (!grant.connection || grant.connection.isActive === false) {
      throw new InvalidTokenError('A conexao MCP foi desativada ou removida.');
    }
    if (!isAcceptableResource(grant.resource)) {
      throw new InvalidTokenError('Token emitido para outro resource server.');
    }
    if (!grant.userId) {
      throw new InvalidTokenError('Token sem usuario autorizador.');
    }

    // Sinal de "esta IA esta ativa?" na pagina de conexoes. Best-effort: um
    // erro aqui nao deve derrubar a chamada MCP.
    prisma.mcpGrant
      .update({ where: { id: grant.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return {
      token,
      clientId: grant.clientId,
      scopes: grant.scopes,
      expiresAt: Math.floor(grant.expiresAt.getTime() / 1000),
      ...(grant.resource ? { resource: new URL(grant.resource) } : {}),
      extra: {
        connectionId: grant.connectionId,
        userId: grant.userId,
        tools: grant.connection.tools,
        connectionName: grant.connection.name,
      },
    };
  },

  async revokeToken(client, request) {
    if (!request?.token) return;

    await prisma.mcpGrant.updateMany({
      where: { tokenHash: sha256(request.token), clientId: client.client_id },
      data: { revokedAt: new Date() },
    });
  },
};

module.exports = {
  provider,
  clientsStore,
  sha256,
  newSecret,
  isAcceptableResource,
  resolveFrontendUrl,
  resolveResourceUrl,
  AUTH_REQUEST_TTL_MS,
  CODE_TTL_MS,
  ACCESS_TTL_MS,
  REFRESH_TTL_MS,
  InvalidClientError,
};
