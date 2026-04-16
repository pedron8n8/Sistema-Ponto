const express = require('express');
const publicApiAuthMiddleware = require('../middlewares/publicApiAuth.middleware');
const {
  getPayrollTimeEntries,
  getPayrollSummary,
} = require('../controllers/publicApi.controller');

const router = express.Router();

router.use(publicApiAuthMiddleware);

/**
 * GET /public/payroll/time-entries
 * Retorna eventos de ponto para integração externa de folha
 */
router.get('/payroll/time-entries', getPayrollTimeEntries);

/**
 * GET /public/payroll/summary
 * Retorna sumário diário por colaborador para integração externa
 */
router.get('/payroll/summary', getPayrollSummary);

module.exports = router;
