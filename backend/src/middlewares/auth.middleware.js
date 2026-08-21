const { supabase } = require('../config/supabase');
const { prisma } = require('../config/database');
const { verifyTeamInviteToken } = require('../utils/teamInviteToken');
const { resolveMcpAccessToken } = require('../mcp/tokenAuth');

const TEAM_MEMBER_ROLES = ['INTEGRATOR', 'HR', 'SUPERVISOR', 'MEMBER'];

const USER_INCLUDE = {
  supervisor: {
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
    },
  },
  adminPlan: true,
  organizationAdmin: {
    select: {
      adminPlan: true,
      adminPlanStatus: true,
    },
  },
};

const resolveProvisionedName = (supabaseUser) => {
  const metadata = supabaseUser?.user_metadata || {};
  const candidates = [
    metadata.name,
    metadata.full_name,
    metadata.given_name,
    supabaseUser?.email ? String(supabaseUser.email).split('@')[0] : null,
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim();
    if (normalized.length >= 2) {
      return normalized;
    }
  }

  return 'Novo Admin';
};

const resolveProvisionedPhone = (supabaseUser) => {
  const metadata = supabaseUser?.user_metadata || {};
  const candidates = [
    metadata.phone,
    metadata.phone_number,
    metadata.phoneNumber,
    supabaseUser?.phone,
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim();
    if (normalized.length >= 3) {
      return normalized;
    }
  }

  return null;
};

const resolveInviteTokenFromMetadata = (supabaseUser) => {
  const metadata = supabaseUser?.user_metadata || {};
  const candidates = [metadata.teamInviteToken, metadata.inviteToken];

  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim();
    if (normalized) {
      return normalized;
    }
  }

  return null;
};

const buildAdminSeatPurchaseUrl = () => {
  const frontendUrl = String(process.env.FRONTEND_URL || 'https://app.omnipunt.com').trim();
  return `${frontendUrl}/app/admin/comprar-assentos`;
};

const provisionInvitedTeamMemberIfMissing = async ({ supabaseUser, inviteToken }) => {
  const invite = verifyTeamInviteToken(inviteToken);
  const normalizedEmail = String(supabaseUser?.email || '').trim().toLowerCase();
  const resolvedPhone = resolveProvisionedPhone(supabaseUser);

  if (!normalizedEmail) {
    throw new Error('Supabase user sem email para provisionamento de convite');
  }

  const existingByEmail = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });

  if (existingByEmail && existingByEmail.id !== supabaseUser.id) {
    throw new Error('Esse email ja esta cadastrado. Faca login com a conta existente ou peca ao SUPERADMIN para excluir a conta antiga.');
  }

  const ownerAdmin = await prisma.user.findUnique({
    where: { id: invite.adminId },
    select: {
      id: true,
      role: true,
      isActive: true,
      adminSeatLimit: true,
    },
  });

  if (!ownerAdmin || ownerAdmin.role !== 'ADMIN' || ownerAdmin.isActive === false) {
    throw new Error('Convite invalido: administrador dono do convite nao encontrado.');
  }

  const nextRole = TEAM_MEMBER_ROLES.includes(invite.role) ? invite.role : null;
  if (!nextRole) {
    throw new Error('Convite invalido: role nao permitida para time.');
  }

  const seatLimit = Number(ownerAdmin.adminSeatLimit);
  if (Number.isFinite(seatLimit)) {
    const occupiedSeats = await prisma.user.count({
      where: {
        organizationAdminId: ownerAdmin.id,
        role: { in: TEAM_MEMBER_ROLES },
        isActive: true,
      },
    });

    if (occupiedSeats >= seatLimit) {
      const purchaseUrl = buildAdminSeatPurchaseUrl();
      throw new Error(
        `Convite invalido: nao ha assentos disponiveis no time. Peça ao admin para comprar mais em ${purchaseUrl}`
      );
    }
  }

  await prisma.user.upsert({
    where: { id: supabaseUser.id },
    update: {
      email: normalizedEmail,
      ...(supabaseUser.user_metadata?.name && {
        name: String(supabaseUser.user_metadata.name).trim(),
      }),
      ...(resolvedPhone !== null && { phone: resolvedPhone }),
      role: nextRole,
      organizationAdminId: ownerAdmin.id,
      supervisorId: null,
      isActive: true,
    },
    create: {
      id: supabaseUser.id,
      email: normalizedEmail,
      name: resolveProvisionedName(supabaseUser),
      ...(resolvedPhone !== null && { phone: resolvedPhone }),
      role: nextRole,
      organizationAdminId: ownerAdmin.id,
      supervisorId: null,
      isActive: true,
    },
  });

  return {
    role: nextRole,
    organizationAdminId: ownerAdmin.id,
  };
};

const provisionBuyerAdminIfMissing = async (supabaseUser) => {
  const normalizedEmail = String(supabaseUser?.email || '').trim().toLowerCase();
  const resolvedPhone = resolveProvisionedPhone(supabaseUser);
  if (!normalizedEmail) {
    throw new Error('Supabase user sem email para provisionamento');
  }

  const existingByEmail = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });

  if (existingByEmail && existingByEmail.id !== supabaseUser.id) {
    throw new Error('Esse email ja esta cadastrado. Faca login com a conta existente ou peca ao SUPERADMIN para excluir a conta antiga.');
  }

  await prisma.user.upsert({
    where: { id: supabaseUser.id },
    update: {
      email: normalizedEmail,
      ...(supabaseUser.user_metadata?.name && {
        name: String(supabaseUser.user_metadata.name).trim(),
      }),
      ...(resolvedPhone !== null && { phone: resolvedPhone }),
      isActive: true,
    },
    create: {
      id: supabaseUser.id,
      email: normalizedEmail,
      name: resolveProvisionedName(supabaseUser),
      ...(resolvedPhone !== null && { phone: resolvedPhone }),
      role: 'ADMIN',
      organizationAdminId: supabaseUser.id,
      adminPlanStatus: 'INACTIVE',
      isActive: true,
    },
  });
};

const normalizeLegacyPlanCode = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return 'STARTER';
  return normalized === 'BASE' ? 'STARTER' : normalized;
};

/**
 * Calcula o plano vigente a partir do admin dono do workspace e o anexa ao user.
 * Extraido para que o caminho de token MCP monte exatamente o mesmo req.user que
 * o caminho do Supabase — e o que faz roleCheck/requirePlan/visibleUsers valerem
 * igual para as duas credenciais.
 */
const attachCurrentPlan = (user) => {
  let currentPlan = 'STARTER';
  let currentPlanStatus = 'INACTIVE';

  if (user.role === 'SUPERADMIN') {
    currentPlan = 'PRO'; // Superadmin tem tudo
    currentPlanStatus = 'ACTIVE';
  } else if (user.role === 'ADMIN') {
    currentPlan = normalizeLegacyPlanCode(user.adminPlan?.code || 'STARTER');
    currentPlanStatus = user.adminPlanStatus;
  } else if (user.organizationAdmin) {
    currentPlan = normalizeLegacyPlanCode(user.organizationAdmin.adminPlan?.code || 'STARTER');
    currentPlanStatus = user.organizationAdmin.adminPlanStatus;
  }

  user.currentPlan = currentPlan;
  user.currentPlanStatus = currentPlanStatus;

  return user;
};

/**
 * Middleware de autenticação
 * Valida o token JWT do Supabase e busca o usuário no banco local
 */
const authMiddleware = async (req, res, next) => {
  try {
    // Extrai o token do header Authorization
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Token de autenticação não fornecido',
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer '

    // Segunda via de credencial: token de uma conexao MCP. E o que permite a
    // ponte de src/mcp/bridge.js atravessar esta cadeia sem um JWT do Supabase.
    // Devolve null silenciosamente quando nao e um token MCP, para nao alterar o
    // comportamento do caminho normal.
    const mcpGrant = await resolveMcpAccessToken(token);

    if (mcpGrant) {
      const mcpUser = await prisma.user.findUnique({
        where: { id: mcpGrant.userId },
        include: USER_INCLUDE,
      });

      if (!mcpUser) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'O usuario que autorizou esta conexao MCP nao existe mais.',
        });
      }

      if (mcpUser.isActive === false) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'O usuario que autorizou esta conexao MCP esta desativado.',
        });
      }

      attachCurrentPlan(mcpUser);

      req.user = mcpUser;
      req.token = token;
      // Sem supabaseUser: nao ha provisionamento just-in-time neste caminho.
      req.mcp = {
        connectionId: mcpGrant.connectionId,
        connectionName: mcpGrant.connectionName,
        tools: mcpGrant.tools,
        scopes: mcpGrant.scopes,
        clientId: mcpGrant.clientId,
        toolName: req.get('x-mcp-tool') || null,
      };

      return next();
    }

    // Valida o token com o Supabase
    const {
      data: { user: supabaseUser },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !supabaseUser) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Token inválido ou expirado',
      });
    }

    // Busca o usuário no banco local
    let user = await prisma.user.findUnique({
      where: { id: supabaseUser.id },
      include: USER_INCLUDE,
    });

    // Provisiona comprador ADMIN automaticamente no primeiro login.
    if (!user) {
      const inviteToken = resolveInviteTokenFromMetadata(supabaseUser);

      if (inviteToken) {
        try {
          await provisionInvitedTeamMemberIfMissing({ supabaseUser, inviteToken });
        } catch (inviteError) {
          return res.status(403).json({
            error: 'Forbidden',
            message: inviteError.message || 'Convite invalido ou expirado.',
          });
        }
      } else {
        await provisionBuyerAdminIfMissing(supabaseUser);
      }

      user = await prisma.user.findUnique({
        where: { id: supabaseUser.id },
        include: USER_INCLUDE,
      });

      if (!user) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Nao foi possivel provisionar usuario local.',
        });
      }
    }

    if (user.isActive === false) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Usuario desativado. Entre em contato com o administrador do time.',
      });
    }

    attachCurrentPlan(user);

    // Adiciona o usuário e o token na requisição
    req.user = user;
    req.token = token;
    req.supabaseUser = supabaseUser;

    next();
  } catch (error) {
    console.error('❌ Erro no middleware de autenticação:', error);
    
    // Tratamento específico de erros do Prisma
    if (error.code === 'P2002') {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Usuário já existe com este email',
      });
    }

    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao validar autenticação',
    });
  }
};

module.exports = authMiddleware;
