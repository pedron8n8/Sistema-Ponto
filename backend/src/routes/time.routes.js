const express = require('express');
const { authMiddleware } = require('../middlewares');
const timeController = require('../controllers/time.controller');

const router = express.Router();

// Todas as rotas de time entries requerem autenticação
router.use(authMiddleware);

/**
 * POST /api/v1/time/clock-in
 * Registra início do ponto
 */
router.post('/clock-in', timeController.clockIn);

/**
 * POST /api/v1/time/clock-out
 * Registra fim do ponto
 */
router.post('/clock-out', timeController.clockOut);

/**
 * GET /api/v1/time/current
 * Retorna o registro de ponto aberto (se existir)
 */
router.get('/current', timeController.getCurrentEntry);

/**
 * GET /api/v1/time/today
 * Retorna todos os registros do dia atual
 */
router.get('/today', timeController.getTodayEntries);

/**
 * GET /api/v1/time/me
 * Retorna histórico de pontos do usuário logado (paginado)
 */
router.get('/me', timeController.getMyTimeEntries);

/**
 * GET /api/v1/time/:id
 * Retorna detalhes de um registro específico
 */
router.get('/:id', timeController.getTimeEntryById);

module.exports = router;
