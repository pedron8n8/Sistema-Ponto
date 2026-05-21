const express = require('express');
const { authMiddleware, roleCheck } = require('../middlewares');
const { buildUserPhotoUrl } = require('../utils/userPhoto');
const { prisma } = require('../config/database');
const { verifyTeamInviteToken } = require('../utils/teamInviteToken');

const router = express.Router();

/**
 * GET /api/v1/auth/invite/preview?token=...
 * Valida convite de equipe e retorna contexto para tela de cadastro.
 */
router.get('/invite/preview', async (req, res) => {
  try {
    const rawToken = String(req.query.token || '').trim();

    if (!rawToken) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Token de convite nao informado.',
      });
    }

    const invite = verifyTeamInviteToken(rawToken);

    const admin = await prisma.user.findUnique({
      where: { id: invite.adminId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
      },
    });

    if (!admin || admin.role !== 'ADMIN' || admin.isActive === false) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Administrador do convite nao encontrado.',
      });
    }

    return res.json({
      invite: {
        role: invite.role,
        expiresAt: invite.expiresAt,
        admin: {
          id: admin.id,
          name: admin.name,
          email: admin.email,
        },
      },
    });
  } catch (error) {
    return res.status(400).json({
      error: 'Bad Request',
      message: error.message || 'Convite invalido ou expirado.',
    });
  }
});

/**
 * GET /api/v1/auth/check-email?email=...
 * Verifica se um email ja esta cadastrado no banco local.
 * Publico (sem auth) para uso no formulario de signup.
 */
router.get('/check-email', async (req, res) => {
  try {
    const rawEmail = String(req.query.email || '').trim().toLowerCase();

    if (!rawEmail || !rawEmail.includes('@')) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Email invalido.',
      });
    }

    const existing = await prisma.user.findUnique({
      where: { email: rawEmail },
      select: { id: true },
    });

    return res.json({ available: !existing });
  } catch (error) {
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao verificar disponibilidade do email.',
    });
  }
});

/**
 * GET /api/v1/auth/me
 * Retorna informações do usuário autenticado
 */
router.get('/me', authMiddleware, (req, res) => {
  const photoUrl = buildUserPhotoUrl(req, req.user.photoPath);

  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      phone: req.user.phone,
      role: req.user.role,
      supervisor: req.user.supervisor,
      photoUrl,
      photoUpdatedAt: req.user.photoUpdatedAt,
      createdAt: req.user.createdAt,
      currentPlan: req.user.currentPlan,
      currentPlanStatus: req.user.currentPlanStatus,
    },
  });
});

/**
 * GET /api/v1/auth/profile
 * Retorna perfil completo do usuário autenticado
 */
router.get('/profile', authMiddleware, (req, res) => {
  const photoUrl = buildUserPhotoUrl(req, req.user.photoPath);

  const safeProfile = { ...req.user };
  delete safeProfile.pinHash;
  delete safeProfile.pinSalt;
  delete safeProfile.pinUpdatedAt;
  delete safeProfile.pinFailedAttempts;
  delete safeProfile.pinLockedUntil;
  delete safeProfile.facialEmbedding;
  delete safeProfile.facialEmbeddingUpdatedAt;
  delete safeProfile.publicApiTokenHash;

  res.json({
    user: {
      ...safeProfile,
      photoUrl,
    },
    supabase: {
      id: req.supabaseUser.id,
      email: req.supabaseUser.email,
      emailConfirmed: req.supabaseUser.email_confirmed_at !== null,
      lastSignIn: req.supabaseUser.last_sign_in_at,
    },
  });
});

module.exports = router;
