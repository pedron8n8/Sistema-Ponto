/**
 * Ponte entre uma tool MCP e o endpoint real de /api/v1.
 *
 * ponytail: chamada HTTP em loopback em vez de invocar o controller direto. Custa
 * um hop em 127.0.0.1 e em troca herda a cadeia inteira — auth.middleware,
 * roleCheck, requirePlan, guards de controller, visibleUsers — mais o parsing
 * real do Express. O shim de req/res sintetico de slack.controller.js:135 funciona
 * porque o Slack toca 6 endpoints homogeneos; para as 80 tools deste catalogo, com
 * stream de arquivo e cadeias de guard variadas, ele viraria fonte de bug.
 * Se o hop virar gargalo, o upgrade e montar o router com req/res sintetico —
 * nunca reescrever as checagens aqui.
 */

const REQUEST_TIMEOUT_MS = Math.max(
  1_000,
  Number(process.env.MCP_TOOL_TIMEOUT_MS || 30_000)
);

const resolveInternalBase = () =>
  String(process.env.BACKEND_INTERNAL_URL || `http://127.0.0.1:${process.env.PORT || 3001}`)
    .replace(/\/+$/, '');

/** Escolhe a rota pelo role de quem autorizou, para as tools que colapsam
 * endpoints duplicados (/admin/* vs /hr/* vs /supervisor/*). */
const resolvePathTemplate = (tool, role) =>
  (tool.routeByRole && tool.routeByRole[role]) || tool.path;

/**
 * Preenche os :params do path com os args de mesmo nome. O que sobra vai para a
 * query (GET/DELETE) ou para o body (POST/PATCH/PUT).
 */
const buildRequest = (tool, args, role) => {
  const template = resolvePathTemplate(tool, role);
  const rest = { ...(args || {}) };

  const path = template.replace(/:([A-Za-z0-9_]+)/g, (_match, key) => {
    const value = rest[key];
    if (value === undefined || value === null || value === '') {
      throw new Error(`Argumento obrigatorio ausente: ${key}`);
    }
    delete rest[key];
    return encodeURIComponent(String(value));
  });

  const usesQuery = tool.method === 'GET' || tool.method === 'DELETE';
  let url = `${resolveInternalBase()}/api/v1${path}`;

  if (usesQuery) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(rest)) {
      if (value === undefined || value === null) continue;
      search.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    const qs = search.toString();
    if (qs) url += `?${qs}`;
    return { url, body: undefined };
  }

  return { url, body: rest };
};

/**
 * @returns {Promise<{status: number, body: unknown}>}
 */
const callApi = async ({ tool, args, token, role }) => {
  const { url, body } = buildRequest(tool, args, role);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: tool.method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        // Rastreia a origem nos logs do backend. Nao e credencial e nao e lido
        // para autorizar nada.
        'X-Mcp-Tool': tool.name,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      // Sem X-Idempotency-*: idempotency.middleware.js:92 so age quando um dos
      // dois headers existe, e a chave tem de ser o sha256 exato de
      // `date|stableStringify(body)`. Omitir e o caminho correto.
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch (_error) {
      // resposta nao-JSON (ex.: erro do proxy): devolve o texto cru
    }

    return { status: response.status, body: parsed };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return {
        status: 504,
        body: {
          error: 'Gateway Timeout',
          message: `A chamada a ${tool.name} passou de ${REQUEST_TIMEOUT_MS}ms.`,
        },
      };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

module.exports = {
  callApi,
  buildRequest,
  resolvePathTemplate,
  resolveInternalBase,
  REQUEST_TIMEOUT_MS,
};
