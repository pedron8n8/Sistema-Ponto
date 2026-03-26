const express = require('express');
const multer = require('multer');
const { authMiddleware, roleCheck } = require('../middlewares');
const userController = require('../controllers/user.controller');
const { photoUpload, MAX_PHOTO_SIZE_BYTES } = require('../middlewares/upload.middleware');

const router = express.Router();

const uploadSinglePhoto = (req, res, next) => {
	photoUpload.single('photo')(req, res, (error) => {
		if (!error) {
			next();
			return;
		}

		if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
			const maxMb = Math.round(MAX_PHOTO_SIZE_BYTES / (1024 * 1024));
			return res.status(400).json({
				error: 'Bad Request',
				message: `Imagem maior que o limite permitido (${maxMb}MB).`,
			});
		}

		return res.status(400).json({
			error: 'Bad Request',
			message: error.message || 'Falha ao processar upload da imagem.',
		});
	});
};

// Todas as rotas de usuário requerem autenticação
router.use(authMiddleware);

/**
 * GET /api/v1/users/me/profile-complete
 * Perfil completo do usuário autenticado
 */
router.get('/me/profile-complete', userController.getMyCompleteProfile);

/**
 * PATCH /api/v1/users/me/account
 * Atualiza nome, email e senha da conta autenticada
 */
router.patch('/me/account', userController.updateMyAccount);

/**
 * POST /api/v1/users/me/photo
 * Upload da foto de perfil do usuário autenticado
 */
router.post('/me/photo', uploadSinglePhoto, userController.uploadMyPhoto);

/**
 * DELETE /api/v1/users/me/photo
 * Remove a foto de perfil do usuário autenticado
 */
router.delete('/me/photo', userController.deleteMyPhoto);

/**
 * GET /api/v1/users/me/face
 * Status do cadastro facial do usuário logado
 */
router.get('/me/face', userController.getMyFaceStatus);

/**
 * POST /api/v1/users/me/face/enroll
 * Cadastra/atualiza reconhecimento facial do usuário logado
 */
router.post('/me/face/enroll', userController.enrollMyFace);

/**
 * DELETE /api/v1/users/me/face
 * Remove reconhecimento facial do usuário logado
 */
router.delete('/me/face', userController.deleteMyFace);

/**
 * GET /api/v1/users
 * Lista usuários (Admin/HR vê todos, Supervisor vê subordinados)
 */
router.get('/', roleCheck(['ADMIN', 'HR', 'SUPERVISOR']), userController.listUsers);

/**
 * GET /api/v1/users/admin-seats
 * Mapa de cadeiras por admin e ocupantes
 */
router.get('/admin-seats', roleCheck(['SUPERADMIN', 'ADMIN', 'HR']), userController.listAdminSeatAssignments);

/**
 * GET /api/v1/users/:id
 * Obtém detalhes de um usuário específico
 */
router.get('/:id', roleCheck(['ADMIN', 'HR', 'SUPERVISOR']), userController.getUserById);

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
