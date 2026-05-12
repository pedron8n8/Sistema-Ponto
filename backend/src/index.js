const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const rateLimitMiddleware = require('./middlewares/rateLimit.middleware');
const idempotencyMiddleware = require('./middlewares/idempotency.middleware');
const { ensureUserPhotoDir } = require('./utils/userPhoto');

// Import routes
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3001;
const permissionsPolicyHeader =
  process.env.PERMISSIONS_POLICY_HEADER ||
  'camera=(), microphone=(), geolocation=(), payment=(), usb=(), midi=()';


const defaultAllowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:3001',
  'https://omnipunt.com',
  'https://www.omnipunt.com',
  'https://app.omnipunt.com',
];
const allowedOrigins = String(process.env.CORS_ALLOWED_ORIGINS || defaultAllowedOrigins.join(','))
  .split(',')
  .map((origin) => origin.trim().replace(/^['"]|['"]$/g, '').replace(/\/$/, ''))
  .filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }

    const cleanOrigin = origin.trim().replace(/\/$/, '');

    if (allowedOrigins.includes(cleanOrigin)) {
      return callback(null, true);
    }

    console.warn(`[CORS] Rejected origin: '${origin}'. Clean origin: '${cleanOrigin}'. Allowed origins:`, allowedOrigins);
    return callback(new Error('Origin nao permitida por CORS'));
  },
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key', 'X-Idempotency-Date'],
  credentials: true,
  optionsSuccessStatus: 200,
};

// Middlewares
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
