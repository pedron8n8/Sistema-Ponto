const crypto = require('crypto');
const { prisma } = require('../config/database');
const { supabase } = require('../config/supabase');

/**
 * In-memory store for OAuth state tokens.
 * Maps state -> { userId, expiresAt }
 *
 * In production with multiple instances you'd use Redis,
 * but for a single-process setup this is fine.
 */
const pendingStates = new Map();
const STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const cleanExpiredStates = () => {
  const now = Date.now();
  for (const [key, value] of pendingStates) {
    if (now > value.expiresAt) {
      pendingStates.delete(key);
    }
  }
};

// Periodically clean up expired states
setInterval(cleanExpiredStates, 60 * 1000);

/**
 * GET /api/v1/integrations/slack/connect?token=<JWT>
 *
 * User clicks a link that includes their JWT as a query param.
 * We validate the token, generate a random OAuth state,
 * store it alongside the user id, and redirect to Slack OAuth.
 */
const startSlackOAuth = async (req, res) => {
  const frontendUrl = String(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  const profileUrl = `${frontendUrl}/app/perfil-completo`;

  // Validate the JWT token from query param
  const token = req.query.token;
  if (!token) {
    return res.redirect(`${profileUrl}?slack=error&reason=missing_token`);
  }

  const { data: { user: supabaseUser }, error: authError } = await supabase.auth.getUser(String(token));

  if (authError || !supabaseUser) {
    return res.redirect(`${profileUrl}?slack=error&reason=invalid_token`);
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) {
    return res.redirect(`${profileUrl}?slack=error&reason=server_config`);
  }

  const backendUrl = resolveBackendUrl(req);
  const redirectUri = `${backendUrl}/api/v1/integrations/slack/callback`;

  const state = crypto.randomBytes(32).toString('hex');

  pendingStates.set(state, {
    userId: supabaseUser.id,
    expiresAt: Date.now() + STATE_TTL_MS,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'openid profile email',
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
  });

  const slackAuthorizeUrl = `https://slack.com/openid/connect/authorize?${params.toString()}`;

  return res.redirect(slackAuthorizeUrl);
};

/**
 * GET /api/v1/integrations/slack/callback
 *
 * Slack redirects here after user authorizes.
 * We exchange the code for a token, extract the Slack user ID,
 * and save it to the user's profile in our database.
 */
const handleSlackOAuthCallback = async (req, res) => {
  const frontendUrl = String(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  const profileUrl = `${frontendUrl}/app/perfil-completo`;

  const { code, state, error: slackError } = req.query;

  if (slackError) {
    console.error('❌ Slack OAuth error:', slackError);
    return res.redirect(`${profileUrl}?slack=error&reason=${encodeURIComponent(String(slackError))}`);
  }

  if (!state || !pendingStates.has(state)) {
    return res.redirect(`${profileUrl}?slack=error&reason=invalid_state`);
  }

  const pending = pendingStates.get(state);
  pendingStates.delete(state);

  if (Date.now() > pending.expiresAt) {
    return res.redirect(`${profileUrl}?slack=error&reason=state_expired`);
  }

  if (!code) {
    return res.redirect(`${profileUrl}?slack=error&reason=missing_code`);
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.redirect(`${profileUrl}?slack=error&reason=server_config`);
  }

  try {
    const backendUrl = resolveBackendUrl(req);
    const redirectUri = `${backendUrl}/api/v1/integrations/slack/callback`;

    // Exchange the authorization code for a token
    const tokenResponse = await fetch('https://slack.com/api/openid.connect.token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: String(code),
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenResponse.ok) {
      console.error('❌ Slack token exchange HTTP error:', tokenResponse.status);
      return res.redirect(`${profileUrl}?slack=error&reason=token_exchange`);
    }

    const tokenData = await tokenResponse.json();

    if (!tokenData.ok) {
      console.error('❌ Slack token exchange error:', tokenData.error);
      return res.redirect(`${profileUrl}?slack=error&reason=${encodeURIComponent(tokenData.error || 'token_failed')}`);
    }

    // Get user info from Slack
    const userInfoResponse = await fetch('https://slack.com/api/openid.connect.userInfo', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    if (!userInfoResponse.ok) {
      console.error('❌ Slack userInfo HTTP error:', userInfoResponse.status);
      return res.redirect(`${profileUrl}?slack=error&reason=userinfo_failed`);
    }

    const userInfo = await userInfoResponse.json();

    if (!userInfo.ok) {
      console.error('❌ Slack userInfo error:', userInfo.error);
      return res.redirect(`${profileUrl}?slack=error&reason=${encodeURIComponent(userInfo.error || 'userinfo_failed')}`);
    }

    // The Slack user ID is in the `sub` field of the OIDC response
    const slackUserId = userInfo.sub || userInfo['https://slack.com/user_id'] || null;
    const slackUserName = userInfo.name || userInfo.given_name || userInfo['https://slack.com/user_name'] || null;
    const slackTeamName = userInfo['https://slack.com/team_name'] || userInfo.team || null;

    if (!slackUserId) {
      console.error('❌ Could not extract Slack user ID from userInfo:', JSON.stringify(userInfo));
      return res.redirect(`${profileUrl}?slack=error&reason=no_slack_id`);
    }

    // Save the Slack data to the user's profile
    await prisma.user.update({
      where: { id: pending.userId },
      data: {
        slackUserId: String(slackUserId),
        slackUserName: slackUserName ? String(slackUserName) : null,
        slackTeamName: slackTeamName ? String(slackTeamName) : null,
      },
    });

    console.log(`✅ Slack vinculado com sucesso: userId=${pending.userId}, slackUserId=${slackUserId}, name=${slackUserName}, team=${slackTeamName}`);

    return res.redirect(`${profileUrl}?slack=success`);
  } catch (err) {
    console.error('❌ Erro no callback do Slack OAuth:', err);
    return res.redirect(`${profileUrl}?slack=error&reason=internal`);
  }
};

/**
 * Resolve the backend base URL from the request or env.
 */
const resolveBackendUrl = (req) => {
  if (process.env.BACKEND_URL) {
    return String(process.env.BACKEND_URL).replace(/\/$/, '');
  }
  const protocol = req.protocol || 'http';
  const host = req.get('host') || `localhost:${process.env.PORT || 3000}`;
  return `${protocol}://${host}`;
};

module.exports = {
  startSlackOAuth,
  handleSlackOAuthCallback,
};
