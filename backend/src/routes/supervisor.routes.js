const express = require('express');
const { authMiddleware, roleCheck } = require('../middlewares');
const {
  getTeamPendingEntries,
  approveEntry,
  rejectEntry,
  requestEdit,
  getEntryDetails,
  getTeamMembers,
  adjustTeamMemberBankHours,
  updateTeamMemberWorkSettings,
  getTeamBankHoursOverview,
  payTeamMemberBankHours,
} = require('../controllers/supervisor.controller');

const router = express.Router();

// Todas as rotas requerem autenticação e role SUPERVISOR ou ADMIN
router.use(authMiddleware);
router.use(roleCheck(['SUPERVISOR', 'ADMIN']));

/**
 * GET /supervisor/team
 * Lista membros da equipe do supervisor
 */
router.get('/team', getTeamMembers);

/**
 * GET /supervisor/entries
 * Lista registros pendentes dos subordinados
 * Query params: status, page, limit, userId, startDate, endDate
 */
router.get('/entries', getTeamPendingEntries);

/**
 * GET /supervisor/entries/:id
 * Detalhes de um registro específico com histórico
 */
router.get('/entries/:id', getEntryDetails);

/**
 * PATCH /supervisor/approve/:id
 * Aprova um registro de ponto
 * Body: { comment?: string }
 */
router.patch('/approve/:id', approveEntry);

/**
 * PATCH /supervisor/reject/:id
 * Rejeita um registro de ponto
 * Body: { comment: string } (obrigatório)
 */
router.patch('/reject/:id', rejectEntry);

/**
 * PATCH /supervisor/request-edit/:id
 * Solicita edição do colaborador
 * Body: { comment: string } (obrigatório)
 */
router.patch('/request-edit/:id', requestEdit);

/**
 * PATCH /supervisor/team/:userId/bank-hours
 * Ajusta ou zera banco de horas de um membro da equipe
 * Body: { minutesDelta?: number, reason: string, resetToZero?: boolean }
 */
router.patch('/team/:userId/bank-hours', adjustTeamMemberBankHours);

/**
 * GET /supervisor/team/bank-hours/overview
 * Lista saldo e pendências de banco de horas da equipe
 */
router.get('/team/bank-hours/overview', getTeamBankHoursOverview);

/**
 * PATCH /supervisor/team/:userId/bank-hours/pay
 * Dá baixa (paga) banco de horas pendente do membro
 * Body: { payAllPending?: boolean, entryIds?: string[], paymentNote?: string }
 */
router.patch('/team/:userId/bank-hours/pay', payTeamMemberBankHours);

/**
 * PATCH /supervisor/team/:userId/work-settings
 * Ajusta jornada de um membro da equipe
 * Body: { contractDailyMinutes?: number, workdayStartTime?: "08:00", workdayEndTime?: "17:00" }
 */
router.patch('/team/:userId/work-settings', updateTeamMemberWorkSettings);

module.exports = router;
