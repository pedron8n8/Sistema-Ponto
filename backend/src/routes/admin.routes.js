const express = require('express');
const { authMiddleware, roleCheck, requirePlan } = require('../middlewares');
const {
  getTimeEntryAuditLog,
  getUserTimeEntries,
  changeUserSupervisor,
  getSystemStats,
  getTeamOverview,
  setUserPin,
  resetUserPin,
  adjustUserBankHours,
  updateUserWorkSettings,
  getBankHoursOverview,
  payUserBankHours,
  getLocationSettings,
  updateLocationSettings,
} = require('../controllers/admin.controller');
const {
  getProFeatureSettings,
  updateProLivenessSettings,
  updateProPublicApiSettings,
  issueProPublicApiToken,
} = require('../controllers/pro.controller');

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

/**
 * PATCH /admin/users/:userId/pin
 * Define/altera PIN de um usuário (apenas ADMIN)
 * Body: { pin: "1234" }
 */
router.patch('/users/:userId/pin', setUserPin);

/**
 * DELETE /admin/users/:userId/pin
 * Reseta/remove PIN de um usuário (apenas ADMIN)
 */
router.delete('/users/:userId/pin', resetUserPin);

/**
 * PATCH /admin/users/:userId/bank-hours
 * Ajusta ou zera saldo de banco de horas
 * Body: { minutesDelta?: number, reason: string, resetToZero?: boolean }
 */
router.patch('/users/:userId/bank-hours', adjustUserBankHours);

/**
 * GET /admin/bank-hours/overview
 * Lista saldo e pendências de banco de horas por colaborador
 */
router.get('/bank-hours/overview', getBankHoursOverview);

/**
 * PATCH /admin/users/:userId/bank-hours/pay
 * Dá baixa (paga) banco de horas pendente
 * Body: { payAllPending?: boolean, entryIds?: string[], paymentNote?: string }
 */
router.patch('/users/:userId/bank-hours/pay', payUserBankHours);

/**
 * PATCH /admin/users/:userId/work-settings
 * Define jornada e valor-hora do colaborador
 * Body: { contractDailyMinutes?: number, workdayStartTime?: "08:00", workdayEndTime?: "17:00", hourlyRate?: number }
 */
router.patch('/users/:userId/work-settings', updateUserWorkSettings);

/**
 * GET /admin/location-settings
 * Configuração de método de validação e geolocalização do estabelecimento
 */
router.get('/location-settings', requirePlan(['GROWTH', 'PRO']), getLocationSettings);

/**
 * PATCH /admin/location-settings
 * Atualiza método de validação e localização do estabelecimento
 */
router.patch('/location-settings', requirePlan(['GROWTH', 'PRO']), updateLocationSettings);

/**
 * GET /admin/pro/settings
 * Configurações do pacote PRO (liveness + API pública)
 */
router.get('/pro/settings', requirePlan('PRO'), getProFeatureSettings);

/**
 * PATCH /admin/pro/liveness
 * Atualiza parâmetros de liveness facial em runtime
 */
router.patch('/pro/liveness', requirePlan('PRO'), updateProLivenessSettings);

/**
 * PATCH /admin/pro/public-api
 * Atualiza configurações da API pública PRO
 */
router.patch('/pro/public-api', requirePlan('PRO'), updateProPublicApiSettings);

/**
 * POST /admin/pro/public-api/token
 * Emite token assinado para integração externa de folha
 */
router.post('/pro/public-api/token', requirePlan('PRO'), roleCheck(['ADMIN']), issueProPublicApiToken);

module.exports = router;
