const express = require('express');
const { authMiddleware, roleCheck } = require('../middlewares');
const {
  getTeamPendingEntries,
  approveEntry,
  rejectEntry,
  requestEdit,
  getEntryDetails,
  getTeamMembers,
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

module.exports = router;
