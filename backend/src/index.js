const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const rateLimitMiddleware = require('./middlewares/rateLimit.middleware');
const idempotencyMiddleware = require('./middlewares/idempotency.middleware');
const { ensureUserPhotoDir } = require('./utils/userPhoto');
const { initGeofenceConfig } = require('./utils/geofence');
const { parseAllowedOrigins, isAllowedOrigin } = require('./utils/corsOrigin');

// Import routes
const routes = require('./routes');
const {
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} = require('@modelcontextprotocol/sdk/server/auth/router.js');
const { requireBearerAuth } = require('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js');
const { provider: mcpOAuthProvider } = require('./mcp/oauthProvider');
const { handleMcpRequest } = require('./mcp/server');
const mcpCatalog = require('./mcp/catalog');

const app = express();
const PORT = process.env.PORT || 3001;
const permissionsPolicyHeader =
  process.env.PERMISSIONS_POLICY_HEADER ||
  'camera=(), microphone=(), geolocation=(), payment=(), usb=(), midi=()';


const allowedOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);

const corsOptions = {
  origin: (origin, callback) => {
    const isProduction = process.env.NODE_ENV === 'production';

    if (isAllowedOrigin(origin, allowedOrigins, { isProduction })) {
      return callback(null, true);
    }

    const cleanOrigin = origin.trim().replace(/\/$/, '');
    console.warn(`[CORS] Rejected origin: '${origin}'. Clean origin: '${cleanOrigin}'. Allowed origins:`, allowedOrigins);
    return callback(new Error('Origin nao permitida por CORS'));
  },
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Idempotency-Key',
    'X-Idempotency-Date',
    'Mcp-Session-Id',
    'MCP-Protocol-Version',
    'Mcp-Method',
    'Mcp-Name',
  ],
  exposedHeaders: ['WWW-Authenticate', 'Mcp-Session-Id'],
  credentials: true,
  optionsSuccessStatus: 200,
};

// Middlewares
// Atras de nginx + Cloudflare. Sem isso o express-rate-limit que o mcpAuthRouter
// (SDK) monta em /authorize, /token e /register joga todos os clientes no mesmo
// balde, porque req.ip vira o IP do container do nginx — e loga ValidationError
// a cada request. 2 hops: nginx e Cloudflare; sobra o cliente real no inicio do
// X-Forwarded-For.
app.set('trust proxy', 2);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

app.use((req, res, next) => {
  if (!res.getHeader('Permissions-Policy')) {
    res.setHeader('Permissions-Policy', permissionsPolicyHeader);
  }
  next();
});

app.use(cors(corsOptions));
app.use(rateLimitMiddleware);
app.use('/api/v1/integrations/slack', express.raw({ type: 'application/x-www-form-urlencoded' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(idempotencyMiddleware);

ensureUserPhotoDir();
initGeofenceConfig().catch(() => undefined);
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));

// Health check route
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API Routes
// --- MCP -------------------------------------------------------------------
// Precisa vir na raiz da app (nao sob /api/v1): o mcpAuthRouter serve
// /.well-known/oauth-authorization-server e /.well-known/oauth-protected-resource,
// que por RFC 8414 e RFC 9728 tem de estar na raiz do host. Isso e o que faz o
// Claude descobrir o fluxo OAuth so com a URL https://api.omnipunt.com/mcp.
const mcpIssuerUrl = new URL(process.env.MCP_ISSUER_URL || 'https://api.omnipunt.com');
const mcpResourceUrl = new URL(process.env.MCP_RESOURCE_URL || 'https://api.omnipunt.com/mcp');

app.use(
  mcpAuthRouter({
    provider: mcpOAuthProvider,
    issuerUrl: mcpIssuerUrl,
    resourceServerUrl: mcpResourceUrl,
    resourceName: 'OmniPunt',
    scopesSupported: mcpCatalog.allScopes(),
  })
);

const mcpResourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(mcpResourceUrl);

app.post(
  '/mcp',
  requireBearerAuth({ verifier: mcpOAuthProvider, resourceMetadataUrl: mcpResourceMetadataUrl }),
  handleMcpRequest
);

// Esta revisao do transporte nao usa GET (stream standalone) nem DELETE (fim de
// sessao): rodamos stateless.
app.all('/mcp', (req, res) => res.status(405).json({
  error: 'Method Not Allowed',
  message: 'O endpoint MCP aceita apenas POST.',
}));

app.use('/api/v1', routes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.url} not found`,
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);

  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'JSON invalido no corpo da requisicao',
    });
  }

  if (err?.message === 'Origin nao permitida por CORS') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Origem nao permitida',
    });
  }

  const knownStatus = Number(err?.statusCode || err?.status || 0);
  let status = Number.isFinite(knownStatus) && knownStatus > 0 ? knownStatus : 500;
  let message = err?.message;

  if (err?.name === 'PublicApiError' && err?.status) {
    status = Number(err.status) || status;
  }

  if (err?.code === 'P2002') {
    status = 409;
    message = 'Registro ja existe com os dados informados.';
  }

  if (err?.code === 'P2025') {
    status = 404;
    message = 'Registro nao encontrado.';
  }

  if (status < 500 && (!message || typeof message !== 'string')) {
    message = 'Erro na requisicao.';
  }

  res.status(status).json({
    error: status < 500 ? 'Request Error' : 'Internal Server Error',
    message: status < 500 ? message : 'Erro interno do servidor',
    ...(status < 500 && err?.code ? { code: err.code } : {}),
  });
});

// Start only the HTTP server here. BullMQ workers run in a separate container/process.
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
