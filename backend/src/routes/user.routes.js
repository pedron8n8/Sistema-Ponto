const express = require('express');
const { authMiddleware, roleCheck } = require('../middlewares');
const userController = require('../controllers/user.controller');

const router = express.Router();

// Todas as rotas de usuário requerem autenticação
router.use(authMiddleware);

/**
 * GET /api/v1/users
 * Lista usuários (Admin vê todos, Supervisor vê subordinados)
 */
router.get('/', roleCheck(['ADMIN', 'SUPERVISOR']), userController.listUsers);

/**
 * GET /api/v1/users/:id
 * Obtém detalhes de um usuário específico
 */
router.get('/:id', roleCheck(['ADMIN', 'SUPERVISOR']), userController.getUserById);

/**
 * POST /api/v1/users
 * Cria novo usuário (apenas Admin)
 */
router.post('/', roleCheck(['ADMIN']), userController.createUser);

/**
 * PATCH /api/v1/users/:id
 * Atualiza dados do usuário (apenas Admin)
 */
router.patch('/:id', roleCheck(['ADMIN']), userController.updateUser);

/**
 * DELETE /api/v1/users/:id
 * Deleta usuário (apenas Admin)
 */
router.delete('/:id', roleCheck(['ADMIN']), userController.deleteUser);

module.exports = router;
