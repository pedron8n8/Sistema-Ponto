/**
 * Gestao das conexoes MCP e o passo de consentimento do fluxo OAuth.
 *
 * Duas metades:
 *  - CRUD das conexoes: quem cria decide o TETO de tools daquela conexao.
 *  - Consentimento: fecha o /authorize iniciado pelo cliente MCP. Quem faz login
 *    aqui escolhe qual conexao autorizar, e a IA passa a agir com a identidade
 *    dessa pessoa. O efetivo e a intersecao entre as tools da conexao e o que o
 *    role/plano/escopo dela ja permitem — a segunda metade dessa intersecao e
 *    aplicada pela cadeia normal da API, nao aqui.
 */

const { prisma } = require('../config/database');
const { resolveTenantOwnerId } = require('../utils/visibleUsers');
const catalog = require('../mcp/catalog');
const {
  sha256,
  newSecret,
  findLiveGrant,
  resolveResourceUrl,
  CODE_TTL_MS,
} = require('../mcp/tokenAuth');

const MANAGER_ROLES = ['ADMIN', 'INTEGRATOR', 'SUPERADMIN'];

const badRequest = (res, message) => res.status(400).json({ error: 'Bad Request', message });
const notFound = (res, message) => res.status(404).json({ error: 'Not Found', message });
const forbidden = (res, message) => res.status(403).json({ error: 'Forbidden', message });

const fail = (res, error, message) => {
  console.error(`❌ ${message}:`, error?.message || error);
  return res.status(500).json({ error: 'Internal Server Error', message });
};

/** Tenant do ator. SUPERADMIN sem tenant proprio nao gerencia conexoes. */
const requireTenant = (req, res) => {
  const ownerId = resolveTenantOwnerId(req.user);
  if (!ownerId) {
    forbidden(res, 'Sua conta nao esta vinculada a uma empresa, entao nao pode ter conexoes MCP.');
    return null;
  }
  return ownerId;
};

const publicConnection = (connection) => ({
  id: connection.id,
  name: connection.name,
  tools: connection.tools,
  toolCount: connection.tools.length,
  scopes: catalog.scopesForTools(connection.tools),
  isActive: connection.isActive,
  createdAt: connection.createdAt,
  updatedAt: connection.updatedAt,
  connectedClients: connection.grants ? connection.grants.length : undefined,
});

// --- catalogo ---------------------------------------------------------------
const getCatalog = async (req, res) => {
  try {
    res.json({
      mcpUrl: resolveResourceUrl(),
      groups: catalog.grouped(),
      totalTools: catalog.TOOLS.length,
    });
  } catch (error) {
    return fail(res, error, 'Erro ao carregar o catalogo MCP.');
  }
};

// --- CRUD de conexoes -------------------------------------------------------
const listConnections = async (req, res) => {
  try {
    const ownerId = requireTenant(req, res);
    if (!ownerId) return undefined;

    const connections = await prisma.mcpConnection.findMany({
      where: { organizationAdminId: ownerId },
      orderBy: { createdAt: 'desc' },
      include: {
        grants: {
          where: { kind: 'ACCESS', revokedAt: null, expiresAt: { gt: new Date() } },
          select: { id: true },
        },
      },
    });

    res.json({
      mcpUrl: resolveResourceUrl(),
      connections: connections.map(publicConnection),
    });
  } catch (error) {
    return fail(res, error, 'Erro ao listar conexoes MCP.');
  }
};

const createConnection = async (req, res) => {
  try {
    const ownerId = requireTenant(req, res);
    if (!ownerId) return undefined;

    const name = String(req.body?.name || '').trim();
    if (name.length < 2) {
      return badRequest(res, 'Informe um nome com pelo menos 2 caracteres para a conexao.');
    }

    const tools = catalog.filterKnownTools(req.body?.tools);
    if (tools.length === 0) {
      return badRequest(res, 'Selecione ao menos uma funcao para a conexao.');
    }

    const connection = await prisma.mcpConnection.create({
      data: { name, organizationAdminId: ownerId, tools },
    });

    res.status(201).json({ connection: publicConnection(connection) });
  } catch (error) {
    return fail(res, error, 'Erro ao criar conexao MCP.');
  }
};

const updateConnection = async (req, res) => {
  try {
    const ownerId = requireTenant(req, res);
    if (!ownerId) return undefined;

    const existing = await prisma.mcpConnection.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.organizationAdminId !== ownerId) {
      return notFound(res, 'Conexao MCP nao encontrada.');
    }

    const data = {};

    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (name.length < 2) {
        return badRequest(res, 'Informe um nome com pelo menos 2 caracteres para a conexao.');
      }
      data.name = name;
    }

    if (req.body?.tools !== undefined) {
      const tools = catalog.filterKnownTools(req.body.tools);
      if (tools.length === 0) {
        return badRequest(res, 'Selecione ao menos uma funcao para a conexao.');
      }
      data.tools = tools;
    }

    if (req.body?.isActive !== undefined) {
      data.isActive = Boolean(req.body.isActive);
    }

    if (Object.keys(data).length === 0) {
      return badRequest(res, 'Nada para atualizar.');
    }

    const connection = await prisma.mcpConnection.update({ where: { id: existing.id }, data });

    res.json({ connection: publicConnection(connection) });
  } catch (error) {
    return fail(res, error, 'Erro ao atualizar conexao MCP.');
  }
};

const deleteConnection = async (req, res) => {
  try {
    const ownerId = requireTenant(req, res);
    if (!ownerId) return undefined;

    const existing = await prisma.mcpConnection.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.organizationAdminId !== ownerId) {
      return notFound(res, 'Conexao MCP nao encontrada.');
    }

    // Cascade nos grants: as IAs conectadas perdem o acesso na proxima chamada.
    await prisma.mcpConnection.delete({ where: { id: existing.id } });

    res.json({ deleted: true, id: existing.id });
  } catch (error) {
    return fail(res, error, 'Erro ao remover conexao MCP.');
  }
};

/** IAs atualmente conectadas a uma conexao. */
const listConnectionClients = async (req, res) => {
  try {
    const ownerId = requireTenant(req, res);
    if (!ownerId) return undefined;

    const connection = await prisma.mcpConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.organizationAdminId !== ownerId) {
      return notFound(res, 'Conexao MCP nao encontrada.');
    }

    const grants = await prisma.mcpGrant.findMany({
      where: {
        connectionId: connection.id,
        kind: { in: ['ACCESS', 'REFRESH'] },
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    });

    const clientIds = Array.from(new Set(grants.map((grant) => grant.clientId)));
    const clients = await prisma.mcpOAuthClient.findMany({ where: { clientId: { in: clientIds } } });
    const clientNameById = new Map(
      clients.map((client) => [client.clientId, client.metadata?.client_name || 'Cliente MCP'])
    );

    // Uma linha por (cliente, usuario autorizador): e assim que a pessoa pensa
    // em "quais IAs estao conectadas", nao por token.
    const seen = new Map();
    for (const grant of grants) {
      const key = `${grant.clientId}:${grant.userId}`;
      const current = seen.get(key);
      const lastUsedAt = grant.lastUsedAt || current?.lastUsedAt || null;

      if (!current) {
        seen.set(key, {
          clientId: grant.clientId,
          clientName: clientNameById.get(grant.clientId) || 'Cliente MCP',
          authorizedBy: grant.user,
          authorizedAt: grant.createdAt,
          lastUsedAt,
          grantIds: [grant.id],
        });
      } else {
        current.grantIds.push(grant.id);
        if (lastUsedAt && (!current.lastUsedAt || lastUsedAt > current.lastUsedAt)) {
          current.lastUsedAt = lastUsedAt;
        }
      }
    }

    res.json({ clients: Array.from(seen.values()) });
  } catch (error) {
    return fail(res, error, 'Erro ao listar clientes da conexao MCP.');
  }
};

/** Desconecta uma IA: revoga todos os grants daquele client nesta conexao. */
const revokeConnectionClient = async (req, res) => {
  try {
    const ownerId = requireTenant(req, res);
    if (!ownerId) return undefined;

    const connection = await prisma.mcpConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.organizationAdminId !== ownerId) {
      return notFound(res, 'Conexao MCP nao encontrada.');
    }

    const clientId = String(req.params.clientId || '').trim();
    if (!clientId) return badRequest(res, 'Informe o clientId a desconectar.');

    const revoked = await prisma.mcpGrant.updateMany({
      where: { connectionId: connection.id, clientId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    res.json({ revoked: revoked.count });
  } catch (error) {
    return fail(res, error, 'Erro ao desconectar cliente MCP.');
  }
};

// --- consentimento ----------------------------------------------------------
/**
 * Dados para a tela de consentimento: quem esta pedindo acesso e quais conexoes
 * o usuario logado pode autorizar.
 */
const getAuthorizationRequest = async (req, res) => {
  try {
    const request = await findLiveGrant('AUTH_REQUEST', req.params.requestId);

    if (!request || request.usedAt) {
      return notFound(
        res,
        'Pedido de autorizacao invalido ou expirado. Tente conectar novamente pelo cliente de IA.'
      );
    }

    const client = await prisma.mcpOAuthClient.findUnique({ where: { clientId: request.clientId } });
    const ownerId = resolveTenantOwnerId(req.user);

    const connections = ownerId
      ? await prisma.mcpConnection.findMany({
          where: { organizationAdminId: ownerId, isActive: true },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    res.json({
      request: {
        id: req.params.requestId,
        clientName: client?.metadata?.client_name || 'Cliente MCP',
        clientUri: client?.metadata?.client_uri || null,
        scopes: request.scopes,
        expiresAt: request.expiresAt,
      },
      actor: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        canManageConnections: MANAGER_ROLES.includes(req.user.role),
      },
      connections: connections.map(publicConnection),
    });
  } catch (error) {
    return fail(res, error, 'Erro ao carregar o pedido de autorizacao MCP.');
  }
};

/**
 * Aprova ou nega o pedido. Nao redireciona: devolve a URL para a pagina navegar,
 * porque a chamada vem de fetch com o JWT do Supabase, nao do navegador direto.
 */
const decideAuthorizationRequest = async (req, res) => {
  try {
    const requestId = String(req.body?.requestId || '').trim();
    const request = await findLiveGrant('AUTH_REQUEST', requestId);

    if (!request || request.usedAt) {
      return notFound(
        res,
        'Pedido de autorizacao invalido ou expirado. Tente conectar novamente pelo cliente de IA.'
      );
    }

    const redirect = new URL(request.redirectUri);
    if (request.state) redirect.searchParams.set('state', request.state);

    const consume = () =>
      prisma.mcpGrant.updateMany({
        where: { id: request.id, usedAt: null },
        data: { usedAt: new Date() },
      });

    if (req.body?.approve === false) {
      const claimed = await consume();
      if (claimed.count !== 1) return notFound(res, 'Pedido de autorizacao ja respondido.');

      redirect.searchParams.set('error', 'access_denied');
      redirect.searchParams.set('error_description', 'Autorizacao negada pelo usuario.');
      return res.json({ redirectUrl: redirect.toString() });
    }

    const ownerId = resolveTenantOwnerId(req.user);
    if (!ownerId) {
      return forbidden(res, 'Sua conta nao esta vinculada a uma empresa com conexoes MCP.');
    }

    const connectionId = String(req.body?.connectionId || '').trim();
    if (!connectionId) return badRequest(res, 'Escolha qual conexao MCP autorizar.');

    const connection = await prisma.mcpConnection.findUnique({ where: { id: connectionId } });

    // Cerca de tenant: ninguem autoriza uma conexao de outra empresa.
    if (!connection || connection.organizationAdminId !== ownerId) {
      return notFound(res, 'Conexao MCP nao encontrada na sua empresa.');
    }
    if (connection.isActive === false) {
      return forbidden(res, 'Essa conexao MCP esta desativada.');
    }

    // Uso unico do pedido antes de emitir o code.
    const claimed = await consume();
    if (claimed.count !== 1) return notFound(res, 'Pedido de autorizacao ja respondido.');

    const code = newSecret();

    await prisma.mcpGrant.create({
      data: {
        kind: 'CODE',
        tokenHash: sha256(code),
        clientId: request.clientId,
        connectionId: connection.id,
        // A IA passa a agir como quem autorizou aqui.
        userId: req.user.id,
        scopes: catalog.scopesForTools(connection.tools),
        resource: request.resource,
        redirectUri: request.redirectUri,
        codeChallenge: request.codeChallenge,
        state: request.state,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });

    redirect.searchParams.set('code', code);

    res.json({ redirectUrl: redirect.toString(), connection: publicConnection(connection) });
  } catch (error) {
    return fail(res, error, 'Erro ao responder o pedido de autorizacao MCP.');
  }
};

module.exports = {
  getCatalog,
  listConnections,
  createConnection,
  updateConnection,
  deleteConnection,
  listConnectionClients,
  revokeConnectionClient,
  getAuthorizationRequest,
  decideAuthorizationRequest,
  MANAGER_ROLES,
};
