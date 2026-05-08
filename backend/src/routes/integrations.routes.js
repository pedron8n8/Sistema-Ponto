const express = require('express');
const slackController = require('../controllers/slack.controller');
const slackOAuthController = require('../controllers/slackOAuth.controller');

const router = express.Router();

/**
 * POST /api/v1/integrations/slack/command
 * Recebe slash commands do Slack.
 */
router.post('/slack/command', slackController.handleSlackCommand);

/**
 * GET /api/v1/integrations/slack/connect
 * Inicia o fluxo OAuth do Slack para vincular a conta do usuario.
 * Aceita o token JWT via query param (?token=...) ja que e um redirect.
 */
router.get('/slack/connect', slackOAuthController.startSlackOAuth);

/**
 * GET /api/v1/integrations/slack/callback
 * Callback do Slack OAuth. Recebe o code, troca pelo token,
 * extrai o Slack user ID e salva no perfil do usuario.
 * NAO requer autenticacao (rota publica, Slack redireciona pra ca).
 */
router.get('/slack/callback', slackOAuthController.handleSlackOAuthCallback);

module.exports = router;
