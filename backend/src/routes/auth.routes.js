const express = require('express');
const { authMiddleware, roleCheck } = require('../middlewares');
const { buildUserPhotoUrl } = require('../utils/userPhoto');

const router = express.Router();

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
      role: req.user.role,
      supervisor: req.user.supervisor,
      photoUrl,
      photoUpdatedAt: req.user.photoUpdatedAt,
      createdAt: req.user.createdAt,
    },
  });
});

/**
 * GET /api/v1/auth/profile
 * Retorna perfil completo do usuário autenticado
 */
router.get('/profile', authMiddleware, (req, res) => {
  const photoUrl = buildUserPhotoUrl(req, req.user.photoPath);

  res.json({
    user: {
      ...req.user,
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
