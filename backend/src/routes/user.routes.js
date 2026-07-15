const express = require('express');
const multer = require('multer');
const { authMiddleware, roleCheck, requirePlan } = require('../middlewares');
const userController = require('../controllers/user.controller');
const financeController = require('../controllers/finance.controller');
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
 * POST /api/v1/users/me/team-invite-link
 * Gera link de convite para o ADMIN montar time com role predefinida
 */
router.post('/me/team-invite-link', roleCheck(['ADMIN']), userController.createMyTeamInviteLink);

/**
 * PATCH /api/v1/users/me/plan
 * Permite ao ADMIN escolher plano e quantidade de cadeiras para a propria conta
 */
router.patch('/me/plan', roleCheck(['ADMIN']), userController.chooseMyPlan);

/**
 * POST /api/v1/users/me/additional-seats/checkout
 * Inicia checkout para compra manual de cadeiras extras
 */
router.post(
	'/me/additional-seats/checkout',
	roleCheck(['ADMIN']),
	userController.createMyAdditionalSeatsCheckout
);

/**
 * PATCH /api/v1/users/me/additional-seats/confirm
 * Confirma checkout de cadeiras extras no Stripe e atualiza snapshot persistido
 */
router.patch(
	'/me/additional-seats/confirm',
	roleCheck(['ADMIN']),
	userController.confirmAdditionalSeatsCheckout
);

/**
 * GET /api/v1/users/me/finance/overview
 * Retorna visão financeira do ADMIN (plano, vencimento e cadeiras)
 */
router.get('/me/finance/overview', roleCheck(['ADMIN']), financeController.getMyFinanceOverview);

/**
 * POST /api/v1/users/me/finance/invoices/sync
 * Sincroniza faturas/sessões Stripe do ADMIN e persiste no banco
 */
router.post('/me/finance/invoices/sync', roleCheck(['ADMIN']), financeController.syncMyFinanceInvoices);

/**
 * GET /api/v1/users/me/finance/invoices
 * Lista faturas financeiras persistidas no banco
 */
router.get('/me/finance/invoices', roleCheck(['ADMIN']), financeController.listMyFinanceInvoices);

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
router.get('/me/face', requirePlan('PRO'), userController.getMyFaceStatus);

/**
 * POST /api/v1/users/me/face/enroll
 * Cadastra/atualiza reconhecimento facial do usuário logado
 */
router.post('/me/face/enroll', requirePlan('PRO'), userController.enrollMyFace);

/**
 * DELETE /api/v1/users/me/face
 * Remove reconhecimento facial do usuário logado
 */
router.delete('/me/face', requirePlan('PRO'), userController.deleteMyFace);

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
 * GET /api/v1/users/superadmin/accounts-overview
 * Visão consolidada de contas e cobrança (apenas SUPERADMIN)
 */
router.get(
	'/superadmin/accounts-overview',
	roleCheck(['SUPERADMIN']),
	userController.listSuperAdminAccountsOverview
);

/**
 * GET /api/v1/users/:id
 * Obtém detalhes de um usuário específico
 */
router.get('/:id', roleCheck(['ADMIN', 'HR', 'SUPERVISOR']), userController.getUserById);

/**
 * POST /api/v1/users
 * Cria novo usuário (Admin cria qualquer role do time; HR só Supervisor/Membro)
 */
router.post('/', roleCheck(['ADMIN', 'HR']), userController.createUser);

/**
 * PATCH /api/v1/users/:id
 * Atualiza dados do usuário (Admin edita qualquer role do time; HR só Supervisor/Membro)
 */
router.patch('/:id', roleCheck(['ADMIN', 'HR']), userController.updateUser);

/**
 * DELETE /api/v1/users/:id
 * Deleta usuário (apenas Admin)
 */
router.delete('/:id', roleCheck(['ADMIN']), userController.deleteUser);

module.exports = router;
