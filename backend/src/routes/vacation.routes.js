const express = require('express');
const { authMiddleware, roleCheck, requirePlan } = require('../middlewares');
const {
  createVacationRequest,
  getMyVacationRequests,
  getTeamVacationRequests,
  getHrVacationRequests,
  reviewVacationBySupervisor,
  reviewVacationByHr,
  getTeamVacationCalendar,
} = require('../controllers/vacation.controller');

const router = express.Router();

router.use(authMiddleware);
router.use(requirePlan(['GROWTH', 'PRO'])); // Somente a partir de GROWTH

/**
 * GET /vacations/me
 * Histórico de solicitações do usuário logado
 */
router.get('/me', getMyVacationRequests);

/**
 * POST /vacations/request
 * Colaborador solicita férias
 */
router.post('/request', createVacationRequest);

/**
 * GET /vacations/team/requests
 * Lista solicitações da equipe do supervisor/admin
 */
router.get('/team/requests', roleCheck(['SUPERVISOR', 'ADMIN']), getTeamVacationRequests);

/**
 * GET /vacations/hr/requests
 * Lista solicitações para decisão final do RH (ADMIN)
 */
router.get('/hr/requests', roleCheck(['HR', 'ADMIN']), getHrVacationRequests);

/**
 * PATCH /vacations/:id/supervisor-review
 * Supervisor aprova/rejeita solicitação
 * Body: { decision: "APPROVE" | "REJECT", comment?: string }
 */
router.patch('/:id/supervisor-review', roleCheck(['SUPERVISOR', 'ADMIN']), reviewVacationBySupervisor);

/**
 * PATCH /vacations/:id/hr-review
 * RH (ADMIN) confirma/rejeita solicitação
 * Body: { decision: "CONFIRM" | "REJECT", comment?: string }
 */
router.patch('/:id/hr-review', roleCheck(['HR', 'ADMIN']), reviewVacationByHr);

/**
 * GET /vacations/team/calendar
 * Calendário mensal/anual da equipe do gestor
 */
router.get('/team/calendar', roleCheck(['SUPERVISOR', 'HR', 'ADMIN']), getTeamVacationCalendar);

module.exports = router;
