/**
 * MCP server (Streamable HTTP, stateless).
 *
 * Um Server + um transporte por request HTTP: sem estado em memoria, porque o
 * backend roda atras do nginx e pode escalar em replicas. proFeatureConfig.js ja
 * mostra o preco de guardar estado de tenant no processo.
 *
 * Usa a classe Server de baixo nivel de proposito: assim o inputSchema do
 * catalogo (JSON Schema cru) vai direto para tools/list, sem passar por zod e sem
 * duas fontes de verdade para a mesma forma de argumento.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const catalog = require('./catalog');
const { callApi } = require('./bridge');
const { prisma } = require('../config/database');

const SERVER_INFO = { name: 'omnipunt', version: '1.0.0' };

const INSTRUCTIONS = [
  'OmniPunt e um sistema de controle de ponto (registro de jornada) multiempresa.',
  '',
  'Esta conexao age com a identidade da pessoa que a autorizou, limitada as tools',
  'que o administrador marcou na conexao MCP. Chame account_whoami quando precisar',
  'saber esse escopo: e o que explica um 403 ou uma lista mais curta do que o',
  'esperado.',
  '',
  'Duas regras do dominio que causam erro se ignoradas:',
  '  1. Marcacao com hora extra pendente nao pode ser aprovada antes de a hora',
  '     extra ser decidida (approvals_approve_overtime / approvals_reject_overtime).',
  '  2. Listagens sao filtradas em silencio pelo escopo de visibilidade, nunca com',
  '     403. Nao conclua que a empresa inteira foi coberta.',
  '',
  'Ids: resolva nomes de pessoas em userId com users_list antes de chamar tools que',
  'pedem userId. Datas vao em YYYY-MM-DD e horarios em ISO 8601 com fuso.',
].join('\n');

/**
 * Plano do usuario satisfaz o exigido pela tool?
 *
 * Espelha requirePlan.middleware.js, incluindo a normalizacao (uppercase e
 * BASE tratado como STARTER) e o `|| 0` para codigo desconhecido. Divergir aqui
 * esconderia da IA uma tool que a API na verdade libera.
 */
const PLAN_RANK = { BASE: 0, STARTER: 1, GROWTH: 2, PRO: 3 };

const normalizePlan = (value) => {
  const raw = String(value || 'STARTER').trim().toUpperCase();
  return raw === 'BASE' ? 'STARTER' : raw;
};

const planAllows = (tool, actor) => {
  if (!tool.plans || tool.plans.length === 0) return true;
  if (actor.role === 'SUPERADMIN') return true;
  if (actor.currentPlanStatus !== 'ACTIVE') return false;

  const have = PLAN_RANK[normalizePlan(actor.currentPlan)] || 0;
  const need = Math.min(...tool.plans.map((plan) => PLAN_RANK[normalizePlan(plan)] || 0));
  return have >= need;
};

const roleAllows = (tool, actor) =>
  actor.role === 'SUPERADMIN' || tool.roles.includes(actor.role);

/**
 * Carrega o usuario autorizador para o pre-filtro de tools/list. Nao e a
 * checagem de autorizacao: essa acontece na cadeia real, no bridge.
 */
const loadActor = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      role: true,
      isActive: true,
      adminPlan: { select: { code: true } },
      adminPlanStatus: true,
      organizationAdmin: { select: { adminPlan: { select: { code: true } }, adminPlanStatus: true } },
    },
  });

  if (!user || user.isActive === false) return null;

  const owner = user.role === 'ADMIN' ? user : user.organizationAdmin || user;

  return {
    id: user.id,
    name: user.name,
    role: user.role,
    currentPlan: owner?.adminPlan?.code || 'STARTER',
    currentPlanStatus: owner?.adminPlanStatus || 'INACTIVE',
  };
};

const toMcpTool = (tool) => ({
  name: tool.name,
  title: tool.title,
  description: tool.description,
  inputSchema: tool.inputSchema,
  annotations: { title: tool.title, ...(tool.annotations || {}) },
});

const textResult = (payload, isError) => ({
  content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

/**
 * @param {{connectionId: string, userId: string, tools: string[]}} grant
 * @param {string} token access token MCP, repassado ao backend pela ponte
 */
const createMcpServer = ({ grant, token }) => {
  const server = new Server(SERVER_INFO, {
    capabilities: { tools: {} },
    instructions: INSTRUCTIONS,
  });

  const granted = Array.isArray(grant.tools) ? grant.tools : [];

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const actor = await loadActor(grant.userId);
    if (!actor) return { tools: [] };

    const tools = granted
      .map((name) => catalog.getTool(name))
      .filter(Boolean)
      .filter((tool) => roleAllows(tool, actor) && planAllows(tool, actor))
      .map(toMcpTool);

    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = catalog.getTool(name);

    if (!tool) {
      return textResult({ error: 'Unknown tool', message: `Tool desconhecida: ${name}.` }, true);
    }

    // Nunca confiar no nome que veio do cliente: revalida o teto da conexao.
    if (!granted.includes(name)) {
      return textResult(
        {
          error: 'Forbidden',
          message:
            `A tool ${name} nao esta habilitada nesta conexao MCP. Um administrador precisa ` +
            'marca-la em Configuracoes > MCP / IA.',
        },
        true
      );
    }

    const actor = await loadActor(grant.userId);
    if (!actor) {
      return textResult(
        { error: 'Unauthorized', message: 'O usuario que autorizou esta conexao foi desativado.' },
        true
      );
    }

    try {
      const { status, body } = await callApi({ tool, args, token, role: actor.role });
      return textResult(body === null ? { status } : body, status >= 400);
    } catch (error) {
      console.error(`❌ Erro na tool MCP ${name}:`, error?.message || error);
      return textResult(
        { error: 'Internal Server Error', message: error?.message || 'Erro ao executar a tool.' },
        true
      );
    }
  });

  return server;
};

/**
 * Handler do POST /mcp. Modo stateless: sessionIdGenerator undefined, um
 * transporte por request, req.body ja parseado por express.json().
 */
const handleMcpRequest = async (req, res) => {
  const auth = req.auth;

  if (!auth?.extra?.connectionId || !auth?.extra?.userId) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Token MCP sem conexao ou usuario autorizador.',
    });
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer({
    grant: {
      connectionId: auth.extra.connectionId,
      userId: auth.extra.userId,
      tools: auth.extra.tools || [],
    },
    token: auth.token,
  });

  // server.close() ja fecha o transporte (Protocol.close chama transport.close),
  // entao fechar os dois daria double close.
  res.on('close', () => {
    server.close().catch(() => undefined);
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('❌ Erro no transporte MCP:', error?.message || error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Erro ao processar a requisicao MCP.',
      });
    }
  }
};

module.exports = {
  createMcpServer,
  handleMcpRequest,
  loadActor,
  roleAllows,
  planAllows,
  normalizePlan,
  SERVER_INFO,
  INSTRUCTIONS,
};
