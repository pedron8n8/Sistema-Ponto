const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const rateLimitMiddleware = require('./middlewares/rateLimit.middleware');
const { ensureUserPhotoDir } = require('./utils/userPhoto');

// Import routes
const routes = require('./routes');

// Import BullMQ worker
const { createReportWorker } = require('./workers/reportWorker');

const app = express();
const PORT = process.env.PORT || 3000;

const defaultAllowedOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const allowedOrigins = String(process.env.CORS_ALLOWED_ORIGINS || defaultAllowedOrigins.join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Origin não permitida por CORS'));
  },
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
  credentials: true,
};

// Middlewares
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(cors(corsOptions));
app.use(rateLimitMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
      message: 'JSON inválido no corpo da requisição',
    });
  }

  if (err?.message === 'Origin não permitida por CORS') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Origem não permitida',
    });
  }

  res.status(err.status || 500).json({
    error: err.status ? 'Request Error' : 'Internal Server Error',
    message: err.status ? err.message : 'Erro interno do servidor',
  });
});

// Start server and worker
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);

  // Inicializa o worker de relatórios
  const reportWorker = createReportWorker();
  console.log('📋 Report worker initialized');
});

module.exports = app;
