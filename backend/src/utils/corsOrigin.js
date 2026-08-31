// Decisao de CORS isolada da app do express para dar para testar sem subir o
// servidor (src/index.js chama app.listen assim que e importado).

const defaultAllowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:3001',
  'https://omnipunt.com',
  'https://www.omnipunt.com',
  'https://app.omnipunt.com',
  // Clientes MCP. O Claude.ai chama o /mcp pelo backend dele, entao isso e
  // cinturao e suspensorio para o caso de a descoberta partir do navegador.
  'https://claude.ai',
  'https://claude.com',
];

// Origens sinteticas que o WebView do Capacitor manda no app nativo: o bundle e
// servido localmente, entao nunca chega uma origem de dominio do produto.
// Android com androidScheme: 'https' manda https://localhost e o iOS manda
// capacitor://localhost. Sao constantes da plataforma, iguais em qualquer
// ambiente — nao sao configuracao de deployment. Por isso ficam embutidas em vez
// de dependerem de CORS_ALLOWED_ORIGINS: na VPS essa env var esta definida e,
// quando existe, substitui a lista default inteira, o que derrubaria o app
// nativo em producao.
const capacitorOrigins = ['https://localhost', 'capacitor://localhost'];

const normalizeOrigin = (origin) =>
  String(origin)
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\/$/, '');

const parseAllowedOrigins = (rawValue) =>
  String(rawValue || defaultAllowedOrigins.join(','))
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);

/**
 * @param {string|undefined} origin  header Origin cru da requisicao
 * @param {string[]} allowedOrigins  allowlist ja normalizada
 * @param {{ isProduction?: boolean }} [options]
 * @returns {boolean}
 */
const isAllowedOrigin = (origin, allowedOrigins = [], options = {}) => {
  // Requisicao sem Origin (server-to-server, curl, same-origin) continua livre.
  if (!origin) {
    return true;
  }

  const cleanOrigin = origin.trim().replace(/\/$/, '');

  if (capacitorOrigins.includes(cleanOrigin)) {
    return true;
  }

  if (allowedOrigins.includes(cleanOrigin)) {
    return true;
  }

  // Em dev, libera qualquer origem localhost/127.0.0.1 (qualquer porta) para
  // que testar local sempre passe no CORS mesmo que o Vite suba em outra porta.
  const isDev = !options.isProduction;
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(cleanOrigin);
  if (isDev && isLocalhost) {
    return true;
  }

  return false;
};

module.exports = {
  defaultAllowedOrigins,
  capacitorOrigins,
  normalizeOrigin,
  parseAllowedOrigins,
  isAllowedOrigin,
};
