const express = require('express');
const { authMiddleware, roleCheck } = require('../middlewares');
const {
  getTimeEntryAuditLog,
  getUserTimeEntries,
  changeUserSupervisor,
  getSystemStats,
  getTeamOverview,
} = require('../controllers/admin.controller');

const router = express.Router();

// Todas as rotas requerem autenticação e role ADMIN
router.use(authMiddleware);
router.use(roleCheck(['ADMIN']));

/**
 * GET /admin/stats
 * Estatísticas gerais do sistema
 * Query params: startDate, endDate
 */
router.get('/stats', getSystemStats);

/**
 * GET /admin/team-overview
 * Visão geral de todas as equipes e supervisores
 */
router.get('/team-overview', getTeamOverview);

/**
 * GET /admin/audit/:timeEntryId
 * Histórico completo de auditoria de um registro de ponto
 */
router.get('/audit/:timeEntryId', getTimeEntryAuditLog);

/**
 * GET /admin/users/:userId/entries
 * Lista todos os registros de ponto de um usuário
 * Query params: page, limit, status, startDate, endDate
 */
router.get('/users/:userId/entries', getUserTimeEntries);

/**
 * PATCH /admin/users/:userId/supervisor
 * Altera o supervisor de um usuário
 * Body: { supervisorId: string | null }
 */
router.patch('/users/:userId/supervisor', changeUserSupervisor);

module.exports = router;
