const express = require('express');
const { authMiddleware, roleCheck } = require('../middlewares');
const {
  createExportJob,
  getJobStatus,
  downloadReport,
  listReports,
  deleteReport,
  getDailyBreakdown,
  getWeeklyTimesheet,
} = require('../controllers/report.controller');

const router = express.Router();

// Todas as rotas requerem autenticação
router.use(authMiddleware);

/**
 * POST /reports/export
 * Inicia uma exportação de registros de ponto
 * Body: { startDate, endDate, status?, userId?, teamId?, format? }
 */
router.post('/export', createExportJob);

/**
 * GET /reports/status/:jobId
 * Verifica o status de uma exportação
 */
router.get('/status/:jobId', getJobStatus);

/**
 * GET /reports/list
 * Lista relatórios gerados recentemente
 */
router.get('/list', listReports);

/**
 * GET /reports/download/:filename
 * Faz download de um relatório
 */
router.get('/download/:filename', downloadReport);

/**
 * GET /reports/daily-breakdown
 * Detalhamento diário por colaborador
 */
router.get('/daily-breakdown', getDailyBreakdown);

/**
 * GET /reports/weekly-timesheet
 * Timesheet da semana ao vivo, calculado na hora e sem fila.
 * Query: weekStart=YYYY-MM-DD&userId?&timeZone?
 *
 * Fica ACIMA do `router.delete('/:filename')` e sem roleCheck de propósito:
 * herda só o authMiddleware do topo, porque o escopo de quem pode ser
 * consultado é decidido dentro do handler por canViewUser — um MEMBER precisa
 * ler o próprio timesheet, e um SUPERVISOR só a equipe dele.
 */
router.get('/weekly-timesheet', getWeeklyTimesheet);

/**
 * DELETE /reports/:filename
 * Remove um relatório (apenas ADMIN)
 */
router.delete('/:filename', roleCheck(['ADMIN']), deleteReport);

module.exports = router;
