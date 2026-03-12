const express = require('express');
const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const timeRoutes = require('./time.routes');
const supervisorRoutes = require('./supervisor.routes');
const reportRoutes = require('./report.routes');
const adminRoutes = require('./admin.routes');

const router = express.Router();

// Rotas de autenticação
router.use('/auth', authRoutes);

// Rotas de usuários
router.use('/users', userRoutes);

// Rotas de registro de ponto
router.use('/time', timeRoutes);

// Rotas de supervisor (aprovação de pontos)
router.use('/supervisor', supervisorRoutes);

// Rotas de relatórios
router.use('/reports', reportRoutes);

// Rotas administrativas
router.use('/admin', adminRoutes);

// Health check (sem autenticação)
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// Rota de teste protegida por autenticação
router.get('/protected', require('../middlewares').authMiddleware, (req, res) => {
  res.json({
    message: 'Rota protegida acessada com sucesso!',
    user: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
    },
  });
});

// Rota de teste protegida por role (apenas ADMIN)
router.get(
  '/admin-only',
  require('../middlewares').authMiddleware,
  require('../middlewares').roleCheck(['ADMIN']),
  (req, res) => {
    res.json({
      message: 'Rota administrativa acessada com sucesso!',
      user: {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
      },
    });
  }
);

// Rota de teste protegida por role (ADMIN ou SUPERVISOR)
router.get(
  '/supervisor-access',
  require('../middlewares').authMiddleware,
  require('../middlewares').roleCheck(['ADMIN', 'SUPERVISOR']),
  (req, res) => {
    res.json({
      message: 'Rota de supervisor acessada com sucesso!',
      user: {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
      },
    });
  }
);

module.exports = router;
