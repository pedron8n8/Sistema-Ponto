const express = require('express');
const { authMiddleware, roleCheck } = require('../middlewares');
const {
  createExportJob,
  getJobStatus,
  downloadReport,
  listReports,
  deleteReport,
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
 * DELETE /reports/:filename
 * Remove um relatório (apenas ADMIN)
 */
router.delete('/:filename', roleCheck(['ADMIN']), deleteReport);

module.exports = router;
