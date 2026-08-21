/**
 * Catalogo de tools MCP.
 *
 * Cada entrada mapeia uma tool MCP para um endpoint real de /api/v1. O dispatcher
 * (src/mcp/bridge.js) chama esse endpoint por HTTP em loopback com o proprio token
 * MCP no Authorization, entao TODA a autorizacao continua sendo feita pela cadeia
 * existente: auth.middleware -> roleCheck -> requirePlan -> guards de controller
 * -> utils/visibleUsers. Nada e reimplementado aqui.
 *
 * IMPORTANTE sobre `roles` e `plans`: sao uma COPIA dos guards das rotas e servem
 * apenas para pre-filtrar tools/list, evitando mostrar a IA uma tool que ela nao
 * pode usar. Se divergirem do guard real, o pior caso e uma tool aparecer e a API
 * devolver o 403 verdadeiro. Nunca um bypass.
 *
 * Fora do catalogo, de proposito:
 *  - /health, /api/v1/health, /api/v1/protected, /api/v1/admin-only,
 *    /api/v1/supervisor-access            -> rotas de smoke-test
 *  - /supervisor/presence/stream          -> SSE; use team_get_presence
 *  - /integrations/slack/*                -> autenticado por assinatura do Slack
 *  - /public/payroll/*                    -> redundante com o proprio MCP
 *  - /auth/check-email, /auth/invite/preview -> publicos, sem valor para IA
 *  - POST /users/me/photo                 -> multipart
 *  - POST /users/me/face/enroll           -> exige camera e descriptor facial
 *  - GET /reports/download/:filename      -> stream de arquivo; use reports_list
 */

const shared = require('./_shared');

const GROUPS = {
  time: { label: 'Ponto (proprio)', labelEn: 'Time clock (self)' },
  team: { label: 'Equipe e presenca', labelEn: 'Team and presence' },
  approvals: { label: 'Aprovacoes e horas extras', labelEn: 'Approvals and overtime' },
  timesheet: { label: 'Folha de ponto (RH)', labelEn: 'Timesheet (HR)' },
  bankhours: { label: 'Banco de horas', labelEn: 'Hour bank' },
  vacations: { label: 'Ferias e ausencias', labelEn: 'Vacations and time off' },
  reports: { label: 'Relatorios', labelEn: 'Reports' },
  account: { label: 'Conta propria', labelEn: 'Own account' },
  users: { label: 'Usuarios e equipe', labelEn: 'Users and team' },
  settings: { label: 'Configuracoes do tenant', labelEn: 'Tenant settings' },
  billing: { label: 'Financeiro e assentos', labelEn: 'Billing and seats' },
  platform: { label: 'Plataforma (SUPERADMIN)', labelEn: 'Platform (SUPERADMIN)' },
};

const TOOLS = [
  require('./time'),
  require('./team'),
  require('./approvals'),
  require('./timesheet'),
  require('./bankhours'),
  require('./vacations'),
  require('./reports'),
  require('./users'),
  require('./settings'),
  require('./billing'),
].flat();

const byName = new Map();
for (const tool of TOOLS) {
  if (byName.has(tool.name)) {
    throw new Error(`Catalogo MCP invalido: tool duplicada "${tool.name}".`);
  }
  if (!GROUPS[tool.group]) {
    throw new Error(`Catalogo MCP invalido: grupo desconhecido "${tool.group}" em "${tool.name}".`);
  }
  if (!['read', 'write'].includes(tool.access)) {
    throw new Error(`Catalogo MCP invalido: access "${tool.access}" em "${tool.name}".`);
  }
  if (!tool.method || !tool.path) {
    throw new Error(`Catalogo MCP invalido: method ou path ausente em "${tool.name}".`);
  }
  if (!Array.isArray(tool.roles) || tool.roles.length === 0) {
    throw new Error(`Catalogo MCP invalido: roles ausente em "${tool.name}".`);
  }
  if (!tool.inputSchema || tool.inputSchema.type !== 'object') {
    throw new Error(`Catalogo MCP invalido: inputSchema deve ser um object schema em "${tool.name}".`);
  }
  byName.set(tool.name, tool);
}

const getTool = (name) => byName.get(name) || null;

const toolNames = () => Array.from(byName.keys());

/** Escopos OAuth coarse derivados das tools — e o que o Claude mostra no consentimento. */
const scopesForTools = (names) => {
  const scopes = new Set();
  for (const name of names || []) {
    const tool = byName.get(name);
    if (tool) scopes.add(`${tool.group}:${tool.access}`);
  }
  return Array.from(scopes).sort();
};

const allScopes = () => scopesForTools(toolNames());

/** Nomes validos apenas; usado para validar o que a pagina de permissoes envia. */
const filterKnownTools = (names) =>
  Array.from(new Set((Array.isArray(names) ? names : []).filter((name) => byName.has(name))));

/** Catalogo agrupado, para montar a pagina de permissoes. */
const grouped = () =>
  Object.entries(GROUPS)
    .map(([key, meta]) => ({
      group: key,
      label: meta.label,
      labelEn: meta.labelEn,
      tools: TOOLS.filter((tool) => tool.group === key).map((tool) => ({
        name: tool.name,
        title: tool.title,
        titleEn: tool.titleEn || tool.title,
        description: tool.description,
        access: tool.access,
        roles: tool.roles,
        plans: tool.plans || null,
        method: tool.method,
        path: tool.path,
        sensitive: tool.sensitive === true,
      })),
    }))
    .filter((entry) => entry.tools.length > 0);

module.exports = {
  ...shared,
  GROUPS,
  TOOLS,
  getTool,
  toolNames,
  scopesForTools,
  allScopes,
  filterKnownTools,
  grouped,
};
