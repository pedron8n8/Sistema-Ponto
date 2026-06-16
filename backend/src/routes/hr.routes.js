const express = require('express');
const { authMiddleware, roleCheck } = require('../middlewares');
const {
  getHrTeam,
  getHrDaily,
  getHrUserDaily,
  updateHrEntry,
  createHrEntry,
  deleteHrEntry,
  updateHrWorkSettings,
} = require('../controllers/hr.controller');

const router = express.Router();

// Todas as rotas de RH exigem autenticação e role HR ou ADMIN (SUPERADMIN ignora a checagem).
router.use(authMiddleware);
router.use(roleCheck(['HR', 'ADMIN']));

/**
 * GET /hr/team
 * Lista colaboradores da organização.
 */
router.get('/team', getHrTeam);

/**
 * GET /hr/daily?date=YYYY-MM-DD
 * Visão por data: tempo trabalhado de todos os colaboradores no dia.
 */
router.get('/daily', getHrDaily);

/**
 * GET /hr/users/:userId/daily?startDate&endDate
 * Visão por colaborador: registros agrupados por dia.
 */
router.get('/users/:userId/daily', getHrUserDaily);

/**
 * POST /hr/users/:userId/entries
 * Adiciona um registro completo (dia esquecido). Aprovado automaticamente.
 */
router.post('/users/:userId/entries', createHrEntry);

/**
 * PATCH /hr/entries/:id
 * Edita clock-in/out, intervalo e notas. Recalcula e aprova automaticamente.
 */
router.patch('/entries/:id', updateHrEntry);

/**
 * DELETE /hr/entries/:id
 * Remove um registro e recalcula o dia.
 */
router.delete('/entries/:id', deleteHrEntry);

/**
 * PATCH /hr/users/:userId/work-settings
 * Ajusta a jornada (incl. hourlyRate) do colaborador.
 */
router.patch('/users/:userId/work-settings', updateHrWorkSettings);

module.exports = router;
