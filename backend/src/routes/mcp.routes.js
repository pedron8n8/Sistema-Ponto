const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleCheck = require('../middlewares/roleCheck.middleware');
const {
  getCatalog,
  listConnections,
  createConnection,
  updateConnection,
  deleteConnection,
  listConnectionClients,
  revokeConnectionClient,
  getAuthorizationRequest,
  decideAuthorizationRequest,
} = require('../controllers/mcp.controller');

const router = express.Router();

// Todo este router exige um usuario logado (JWT do Supabase). O endpoint MCP em
// si (POST /mcp) fica fora de /api/v1 e usa requireBearerAuth do SDK.
router.use(authMiddleware);

// --- consentimento ----------------------------------------------------------
// Antes das rotas de gestao, porque qualquer role autenticado pode autorizar uma
// conexao para si — nao so quem pode cria-las.

/** GET /mcp/oauth/request/:requestId — dados da tela de consentimento. */
router.get('/oauth/request/:requestId', getAuthorizationRequest);

/** POST /mcp/oauth/authorize — aprova ou nega e devolve a URL de redirect. */
router.post('/oauth/authorize', decideAuthorizationRequest);

// --- gestao das conexoes ----------------------------------------------------
// INTEGRATOR aparece explicito: roleCheck so o adiciona sozinho quando 'HR'
// esta na lista, e aqui HR nao entra.
router.use(roleCheck(['ADMIN', 'INTEGRATOR']));

/** GET /mcp/catalog — todas as funcoes disponiveis, agrupadas, para a pagina. */
router.get('/catalog', getCatalog);

router.get('/connections', listConnections);
router.post('/connections', createConnection);
router.patch('/connections/:id', updateConnection);
router.delete('/connections/:id', deleteConnection);

/** IAs conectadas e desconexao individual. */
router.get('/connections/:id/clients', listConnectionClients);
router.delete('/connections/:id/clients/:clientId', revokeConnectionClient);

module.exports = router;
