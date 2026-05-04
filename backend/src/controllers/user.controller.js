const { prisma } = require('../config/database');
const fs = require('fs');
const path = require('path');
const { supabaseAdmin } = require('../config/supabase');
const { normalizeEmbedding, DEFAULT_THRESHOLD } = require('../utils/faceRecognition');
const { validateLivenessEvidence } = require('../utils/liveness');
const { buildUserPhotoUrl, normalizePhotoPath } = require('../utils/userPhoto');
const {
  createAdditionalSeatsCheckoutSession,
  verifyAdditionalSeatsCheckoutSession,
  listAdditionalSeatsCheckoutSessions,
  createBasePlanCheckoutSession,
  verifyBasePlanCheckoutSession,
} = require('../utils/seatBilling');
const { INVITABLE_ROLES, issueTeamInviteToken } = require('../utils/teamInviteToken');

const withPhotoUrl = (req, user) => {
  if (!user) return user;
  return {
    ...user,
    photoUrl: buildUserPhotoUrl(req, user.photoPath),
  };
};

const removePhotoFileIfExists = (photoPath) => {
  if (!photoPath) return;

  const normalizedPath = String(photoPath).replace(/^\/+/, '');
  const absolutePath = path.resolve(__dirname, '../../', normalizedPath);

  if (fs.existsSync(absolutePath)) {
    fs.unlinkSync(absolutePath);
  }
};

const ALL_ROLES = ['SUPERADMIN', 'ADMIN', 'HR', 'SUPERVISOR', 'MEMBER'];
const TEAM_MEMBER_ROLES = ['HR', 'SUPERVISOR', 'MEMBER'];
const ADMIN_PLAN_STATUSES = ['ACTIVE', 'INACTIVE'];
const parsedExtraAdminSeatMonthlyUsd = Number(process.env.EXTRA_ADMIN_SEAT_MONTHLY_USD);
const EXTRA_ADMIN_SEAT_MONTHLY_USD = Number(
  (
    Number.isFinite(parsedExtraAdminSeatMonthlyUsd) && parsedExtraAdminSeatMonthlyUsd >= 0
      ? parsedExtraAdminSeatMonthlyUsd
      : 7.5
  ).toFixed(2)
);
const DEFAULT_ADMIN_PLAN_CODE =
  String(process.env.DEFAULT_ADMIN_PLAN_CODE || 'STARTER').trim().toUpperCase() || 'STARTER';
const DEFAULT_ADMIN_PLAN_NAME = String(process.env.DEFAULT_ADMIN_PLAN_NAME || 'Starter').trim() || 'Starter';
const parsedDefaultAdminPlanPrice = Number(process.env.DEFAULT_ADMIN_PLAN_MONTHLY_PRICE);
const DEFAULT_ADMIN_PLAN_MONTHLY_PRICE = Number(
  (Number.isFinite(parsedDefaultAdminPlanPrice) ? parsedDefaultAdminPlanPrice : 30).toFixed(2)
);
const SELF_SERVICE_ADMIN_PLAN_CATALOG = {
  STARTER: {
    code: 'STARTER',
    name: 'Starter',
    monthlyPrice: 30,
    maxSeats: 3,
  },
  GROWTH: {
    code: 'GROWTH',
    name: 'Growth',
    monthlyPrice: 40,
    maxSeats: 5,
  },
  PRO: {
    code: 'PRO',
    name: 'Pro',
    monthlyPrice: 50,
    maxSeats: 7,
  },
};

const resolveIncludedSeatsForPlan = ({ planCode, seatLimit }) => {
  const normalizedPlanCode = String(planCode || '').trim().toUpperCase();
  const catalogPlan = SELF_SERVICE_ADMIN_PLAN_CATALOG[normalizedPlanCode];

  if (catalogPlan) {
    return catalogPlan.maxSeats;
  }

  const parsedSeatLimit = Number(seatLimit);
  if (Number.isFinite(parsedSeatLimit) && parsedSeatLimit >= 0) {
    return Math.floor(parsedSeatLimit);
  }

  return 0;
};

const buildPersistedAdminSeatSnapshot = ({ planCode, seatLimit, occupiedSeats }) => {
  const normalizedOccupiedSeats = Math.max(0, Math.floor(Number(occupiedSeats) || 0));
  const normalizedSeatLimit = Number.isInteger(seatLimit) ? seatLimit : null;
  const includedSeats = resolveIncludedSeatsForPlan({
    planCode,
    seatLimit: normalizedSeatLimit,
  });

  return {
    seatLimit: normalizedSeatLimit,
    activeSeats: normalizedOccupiedSeats,
    contractedExtraSeats:
      normalizedSeatLimit === null ? 0 : Math.max(0, normalizedSeatLimit - includedSeats),
    availableSeats:
      normalizedSeatLimit === null ? null : Math.max(0, normalizedSeatLimit - normalizedOccupiedSeats),
    overageSeats:
      normalizedSeatLimit === null ? 0 : Math.max(0, normalizedOccupiedSeats - normalizedSeatLimit),
  };
};

const syncAdminSeatSnapshot = async (adminUserId) => {
  if (!adminUserId) return null;

  const admin = await prisma.user.findUnique({
    where: { id: adminUserId },
    select: {
      id: true,
      role: true,
      adminSeatLimit: true,
      adminPlan: {
        select: {
          code: true,
        },
      },
    },
  });

  if (!admin || admin.role !== 'ADMIN') {
    return null;
  }

  const occupiedSeats = await prisma.user.count({
    where: {
      organizationAdminId: admin.id,
      role: { in: TEAM_MEMBER_ROLES },
      isActive: true,
    },
  });

  const snapshot = buildPersistedAdminSeatSnapshot({
    planCode: admin.adminPlan?.code,
    seatLimit: admin.adminSeatLimit,
    occupiedSeats,
  });

  await prisma.user.update({
    where: { id: admin.id },
    data: {
      adminActiveSeats: snapshot.activeSeats,
      adminExtraSeatsContracted: snapshot.contractedExtraSeats,
    },
  });

  return snapshot;
};

const parseBooleanFlag = (value) => {
  if (value === true || value === false) return value;
  if (value === undefined || value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const parseOptionalBoolean = (value) => {
  if (value === undefined) return { provided: false, value: null };
  if (value === true || value === false) return { provided: true, value };

  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return { provided: true, value: null };
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return { provided: true, value: true };
  if (['0', 'false', 'no', 'off'].includes(normalized)) return { provided: true, value: false };

  return { provided: true, value: null };
};

const WEAK_PASSWORD_DENYLIST = new Set([
  '123456',
  '12345678',
  'password',
  'qwerty',
  'admin',
  'admin123',
  'teste@123456',
]);

const validateStrongPassword = (password) => {
  const normalizedPassword = String(password || '');

  if (normalizedPassword.length < 12) {
    return 'Senha deve ter no minimo 12 caracteres';
  }

  const hasUppercase = /[A-Z]/.test(normalizedPassword);
  const hasLowercase = /[a-z]/.test(normalizedPassword);
  const hasDigit = /\d/.test(normalizedPassword);
  const hasSpecial = /[^A-Za-z0-9]/.test(normalizedPassword);

  if (!hasUppercase || !hasLowercase || !hasDigit || !hasSpecial) {
    return 'Senha deve conter letra maiuscula, letra minuscula, numero e caractere especial';
  }

  if (WEAK_PASSWORD_DENYLIST.has(normalizedPassword.toLowerCase())) {
    return 'Senha muito fraca. Escolha uma senha mais robusta';
  }

  return null;
};

const resolveSelfServicePlanSelection = ({ planCode, seatLimit, seats }) => {
  const normalizedPlanCode = String(planCode || '').trim().toUpperCase();
  const selectedPlan = SELF_SERVICE_ADMIN_PLAN_CATALOG[normalizedPlanCode];

  if (!selectedPlan) {
    return {
      error: `planCode invalido. Valores aceitos: ${Object.keys(SELF_SERVICE_ADMIN_PLAN_CATALOG).join(', ')}`,
    };
  }

  const requestedSeatLimitRaw = seatLimit === undefined ? seats : seatLimit;
  const requestedSeatLimit = Number(requestedSeatLimitRaw);

  if (!Number.isInteger(requestedSeatLimit) || requestedSeatLimit < 1) {
    return {
      error: 'seatLimit deve ser um numero inteiro maior ou igual a 1.',
    };
  }

  if (requestedSeatLimit > selectedPlan.maxSeats) {
    return {
      error: `O plano ${selectedPlan.code} permite no maximo ${selectedPlan.maxSeats} cadeiras.`,
    };
  }

  return {
    selectedPlan,
    requestedSeatLimit,
  };
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toPositiveInteger = (value, fallback = 1) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : fallback;
};

const toIsoFromUnixSeconds = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return new Date(parsed * 1000).toISOString();
};

const isUnknownPhoneSelectError = (error) => {
  const message = String(error?.message || '');
  return (
    message.includes('Unknown field `phone` for select statement on model `User`') ||
    message.includes('Unknown field `phone`')
  );
};

const fromMinorCurrencyToMajor = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number((parsed / 100).toFixed(2));
};

const buildSeatSummary = ({ adminUser, currentTeamSize, nextTeamSize }) => {
  const seatLimit = adminUser.adminSeatLimit;
  const unitPrice = EXTRA_ADMIN_SEAT_MONTHLY_USD;

  if (seatLimit === null || seatLimit === undefined) {
    return {
      seatLimit: null,
      currentTeamSize,
      nextTeamSize,
      overageSeats: 0,
      unitPrice,
      amountDue: 0,
      requiresPayment: false,
    };
  }

  const overageSeats = Math.max(0, nextTeamSize - seatLimit);
  const amountDue = Number((overageSeats * unitPrice).toFixed(2));

  return {
    seatLimit,
    currentTeamSize,
    nextTeamSize,
    overageSeats,
    unitPrice,
    amountDue,
    requiresPayment: overageSeats > 0,
  };
};

const resolveSeatAvailability = ({ seatSummary, occupiedSeats }) => {
  if (seatSummary.seatLimit === null || seatSummary.seatLimit === undefined) {
    return null;
  }

  return Math.max(0, seatSummary.seatLimit - occupiedSeats);
};

const buildFrontendAppUrl = (pathWithQuery = '') => {
  const frontendUrl = String(process.env.FRONTEND_URL || 'https://app.omnipunt.com').trim();
  const normalizedPath = String(pathWithQuery || '').startsWith('/')
    ? String(pathWithQuery || '')
    : `/${String(pathWithQuery || '').trim()}`;

  return `${frontendUrl}${normalizedPath}`;
};

const resolveAppReturnPath = (value, fallback = '/app') => {
  const normalized = String(value || '').trim();
  if (normalized === '/app' || normalized.startsWith('/app/')) {
    return normalized;
  }

  return fallback;
};

const resolveAdminSeatConfig = ({ adminSeatLimit, adminExtraSeatPrice }) => {
  const nextSeatLimit = adminSeatLimit === undefined ? 10 : Number(adminSeatLimit);
  if (!Number.isInteger(nextSeatLimit) || nextSeatLimit < 1) {
    return {
      error: 'adminSeatLimit deve ser um número inteiro maior ou igual a 1',
    };
  }

  const nextExtraSeatPrice =
    adminExtraSeatPrice === undefined || adminExtraSeatPrice === null || adminExtraSeatPrice === ''
      ? EXTRA_ADMIN_SEAT_MONTHLY_USD
      : Number(adminExtraSeatPrice);

  if (!Number.isFinite(nextExtraSeatPrice) || nextExtraSeatPrice < 0) {
    return {
      error: 'adminExtraSeatPrice deve ser um número maior ou igual a 0',
    };
  }

  return {
    adminSeatLimit: nextSeatLimit,
    adminExtraSeatPrice: Number(nextExtraSeatPrice.toFixed(2)),
  };
};

const normalizeAdminPlanStatus = (value, fallback = 'INACTIVE') => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = String(value).trim().toUpperCase();
  if (!ADMIN_PLAN_STATUSES.includes(normalized)) {
    return null;
  }

  return normalized;
};

const ensureAdminPlanRecord = async ({ code, name, monthlyPrice }) => {
  const normalizedCode = String(code || DEFAULT_ADMIN_PLAN_CODE).trim().toUpperCase();
  const normalizedName = String(name || DEFAULT_ADMIN_PLAN_NAME).trim();
  const normalizedMonthlyPrice =
    monthlyPrice === undefined || monthlyPrice === null || monthlyPrice === ''
      ? DEFAULT_ADMIN_PLAN_MONTHLY_PRICE
      : Number(monthlyPrice);

  if (!normalizedCode) {
    return { error: 'adminPlanCode é obrigatório para vincular plano do ADMIN' };
  }

  if (!normalizedName) {
    return { error: 'adminPlanName é obrigatório para vincular plano do ADMIN' };
  }

  if (!Number.isFinite(normalizedMonthlyPrice) || normalizedMonthlyPrice < 0) {
    return { error: 'adminPlanMonthlyPrice deve ser um número maior ou igual a 0' };
  }

  const plan = await prisma.adminPlan.upsert({
    where: { code: normalizedCode },
    update: {
      ...(name !== undefined && { name: normalizedName }),
      ...(monthlyPrice !== undefined && {
        monthlyPrice: Number(normalizedMonthlyPrice.toFixed(2)),
      }),
      isActive: true,
    },
    create: {
      code: normalizedCode,
      name: normalizedName,
      description: `Plano ${normalizedName}`,
      monthlyPrice: Number(normalizedMonthlyPrice.toFixed(2)),
      isActive: true,
    },
  });

  return { plan };
};

/**
 * Controller para gerenciamento de usuários
 */

/**
 * Criar novo usuário (Admin only)
 * Cria usuário no Supabase e sincroniza com banco local
 */
const createUser = async (req, res) => {
  try {
    const {
      email,
      name,
      role,
      password,
      supervisorId,
      organizationAdminId,
      adminSeatLimit,
      adminExtraSeatPrice,
      adminPlanCode,
      adminPlanName,
      adminPlanMonthlyPrice,
      adminPlanStatus,
      allowPaidOverage,
    } = req.body;

    const requestedRole = role || 'MEMBER';

    // Validações
    if (!email || !email.includes('@')) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Email válido é obrigatório',
      });
    }

    if (!name || name.trim().length < 2) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Nome deve ter pelo menos 2 caracteres',
      });
    }

    if (!password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Senha e obrigatoria',
      });
    }

    const passwordValidationError = validateStrongPassword(password);
    if (passwordValidationError) {
      return res.status(400).json({
        error: 'Bad Request',
        message: passwordValidationError,
      });
    }

    if (!ALL_ROLES.includes(requestedRole)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Role inválida. Valores aceitos: ${ALL_ROLES.join(', ')}`,
      });
    }

    if (req.user.role === 'ADMIN' && !TEAM_MEMBER_ROLES.includes(requestedRole)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Admin só pode criar usuários do time (HR, SUPERVISOR, MEMBER)',
      });
    }

    if (requestedRole === 'SUPERADMIN' && req.user.role !== 'SUPERADMIN') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Apenas SUPERADMIN pode criar outro SUPERADMIN',
      });
    }

    if (requestedRole === 'ADMIN' && req.user.role !== 'SUPERADMIN') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Apenas SUPERADMIN pode criar logins de ADMIN',
      });
    }

    let targetOrganizationAdminId = null;
    let organizationAdmin = null;
    let seatSummary = null;
    let adminSeatConfigData = {};
    let adminPlanConfigData = {};

    if (req.user.role === 'ADMIN') {
      targetOrganizationAdminId = req.user.id;
      organizationAdmin = req.user;
    }

    if (req.user.role === 'SUPERADMIN' && TEAM_MEMBER_ROLES.includes(requestedRole)) {
      if (!organizationAdminId) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'organizationAdminId é obrigatório para criar usuários do time via SUPERADMIN',
        });
      }

      organizationAdmin = await prisma.user.findUnique({
        where: { id: organizationAdminId },
        select: {
          id: true,
          role: true,
          adminSeatLimit: true,
          adminExtraSeatPrice: true,
          adminPlanId: true,
          adminPlanStatus: true,
        },
      });

      if (!organizationAdmin || organizationAdmin.role !== 'ADMIN') {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Administrador responsável não encontrado',
        });
      }

      targetOrganizationAdminId = organizationAdmin.id;
    }

    if (TEAM_MEMBER_ROLES.includes(requestedRole) && targetOrganizationAdminId && !organizationAdmin?.adminPlanId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Não é possível vincular usuário: o ADMIN responsável precisa ter um plano associado.',
      });
    }

    // Validar se supervisor existe (se fornecido)
    if (supervisorId) {
      const supervisor = await prisma.user.findUnique({
        where: { id: supervisorId },
      });

      if (!supervisor) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Supervisor não encontrado',
        });
      }

      if (!['SUPERADMIN', 'ADMIN', 'HR', 'SUPERVISOR'].includes(supervisor.role)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Apenas Admin ou Supervisor podem ser atribuídos como supervisores',
        });
      }

      if (
        req.user.role === 'ADMIN' &&
        supervisor.id !== req.user.id &&
        supervisor.organizationAdminId !== req.user.id
      ) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Supervisor deve pertencer ao seu time de administração',
        });
      }
    }

    // Verifica se já existe usuário com este email
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Já existe um usuário com este email',
      });
    }

    if (requestedRole === 'ADMIN') {
      const seatConfig = resolveAdminSeatConfig({ adminSeatLimit, adminExtraSeatPrice });
      if (seatConfig.error) {
        return res.status(400).json({
          error: 'Bad Request',
          message: seatConfig.error,
        });
      }

      const normalizedPlanStatus = normalizeAdminPlanStatus(adminPlanStatus, 'ACTIVE');
      if (!normalizedPlanStatus) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `adminPlanStatus inválido. Valores aceitos: ${ADMIN_PLAN_STATUSES.join(', ')}`,
        });
      }

      const planRecord = await ensureAdminPlanRecord({
        code: adminPlanCode,
        name: adminPlanName,
        monthlyPrice: adminPlanMonthlyPrice,
      });

      if (planRecord.error) {
        return res.status(400).json({
          error: 'Bad Request',
          message: planRecord.error,
        });
      }

      adminSeatConfigData = {
        adminSeatLimit: seatConfig.adminSeatLimit,
        adminExtraSeatPrice: seatConfig.adminExtraSeatPrice,
        adminActiveSeats: 0,
        adminExtraSeatsContracted: buildPersistedAdminSeatSnapshot({
          planCode: planRecord.plan.code,
          seatLimit: seatConfig.adminSeatLimit,
          occupiedSeats: 0,
        }).contractedExtraSeats,
      };

      adminPlanConfigData = {
        adminPlanId: planRecord.plan.id,
        adminPlanStatus: normalizedPlanStatus,
        adminPlanLinkedAt: new Date(),
      };
    }

    if (TEAM_MEMBER_ROLES.includes(requestedRole) && targetOrganizationAdminId) {
      const adminOwner =
        organizationAdmin ||
        (await prisma.user.findUnique({
          where: { id: targetOrganizationAdminId },
          select: {
            id: true,
            adminSeatLimit: true,
            adminExtraSeatPrice: true,
            adminPlanId: true,
            adminPlanStatus: true,
          },
        }));

      if (!adminOwner?.adminPlanId) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Não é possível criar usuário: o ADMIN responsável está sem plano vinculado.',
        });
      }

      const currentTeamSize = await prisma.user.count({
        where: {
          organizationAdminId: targetOrganizationAdminId,
          role: { in: TEAM_MEMBER_ROLES },
          isActive: true,
        },
      });

      seatSummary = buildSeatSummary({
        adminUser: adminOwner,
        currentTeamSize,
        nextTeamSize: currentTeamSize + 1,
      });

      if (seatSummary.requiresPayment && allowPaidOverage !== true) {
        const checkout = await createAdditionalSeatsCheckoutSession({
          adminUserId: targetOrganizationAdminId,
          adminEmail: req.user?.email,
          overageSeats: seatSummary.overageSeats,
          amountDue: seatSummary.amountDue,
        });

        return res.status(402).json({
          error: 'Payment Required',
          message:
            'Limite de cadeiras excedido. Redirecione para o checkout Stripe para concluir a assinatura das cadeiras adicionais.',
          billing: {
            ...seatSummary,
            stripe: {
              configured: checkout.ok,
              checkoutUrl: checkout.checkoutUrl || null,
              sessionId: checkout.sessionId || null,
              currency: 'usd',
              monthlyUnitPrice: EXTRA_ADMIN_SEAT_MONTHLY_USD,
              monthlyTotal: Number((seatSummary.overageSeats * EXTRA_ADMIN_SEAT_MONTHLY_USD).toFixed(2)),
            },
          },
        });
      }
    }

    // Cria usuário no Supabase
    const { data: supabaseUser, error: supabaseError } = await supabaseAdmin.auth.admin.createUser(
      {
        email,
        password,
        email_confirm: true,
        user_metadata: {
          name,
          role: requestedRole,
          organizationAdminId: requestedRole === 'ADMIN' ? null : targetOrganizationAdminId,
        },
      }
    );

    if (supabaseError) {
      console.error('❌ Erro ao criar usuário no Supabase:', supabaseError);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Erro ao criar usuário no sistema de autenticação',
        details: supabaseError.message,
      });
    }

    const effectiveOrganizationAdminId =
      requestedRole === 'ADMIN' ? supabaseUser.user.id : targetOrganizationAdminId;

    if (requestedRole !== 'SUPERADMIN' && !effectiveOrganizationAdminId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Cada usuário deve estar vinculado a um ADMIN responsável.',
      });
    }

    // Cria usuário no banco local
    const user = await prisma.user.create({
      data: {
        id: supabaseUser.user.id,
        email,
        name: name.trim(),
        role: requestedRole,
        isActive: true,
        supervisorId: supervisorId || null,
        organizationAdminId: effectiveOrganizationAdminId,
        ...adminSeatConfigData,
        ...adminPlanConfigData,
      },
      include: {
        supervisor: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
        organizationAdmin: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
        adminPlan: {
          select: {
            id: true,
            code: true,
            name: true,
            monthlyPrice: true,
            isActive: true,
          },
        },
      },
    });

    try {
      await supabaseAdmin.auth.admin.updateUserById(user.id, {
        user_metadata: {
          name: user.name,
          role: user.role,
          organizationAdminId: user.organizationAdminId,
          isActive: user.isActive,
        },
      });
    } catch (metadataError) {
      console.warn('⚠️ Falha ao sincronizar metadados no Supabase para usuário criado:', metadataError.message);
    }

    const adminToSyncAfterCreate =
      requestedRole === 'ADMIN'
        ? user.id
        : TEAM_MEMBER_ROLES.includes(requestedRole)
          ? effectiveOrganizationAdminId
          : null;

    if (adminToSyncAfterCreate) {
      try {
        await syncAdminSeatSnapshot(adminToSyncAfterCreate);
      } catch (syncError) {
        console.warn('⚠️ Falha ao sincronizar snapshot de cadeiras após criação:', syncError.message);
      }
    }

    console.log(`✅ Usuário criado com sucesso: ${user.email} (${user.role})`);

    res.status(201).json({
      message: 'Usuário criado com sucesso',
      user: withPhotoUrl(req, {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        organizationAdminId: user.organizationAdminId,
        organizationAdmin: user.organizationAdmin,
        adminSeatLimit: user.adminSeatLimit,
        adminExtraSeatPrice: user.adminExtraSeatPrice,
        adminActiveSeats: user.adminActiveSeats,
        adminExtraSeatsContracted: user.adminExtraSeatsContracted,
        adminPlanStatus: user.adminPlanStatus,
        adminPlanLinkedAt: user.adminPlanLinkedAt,
        adminPlan: user.adminPlan,
        supervisor: user.supervisor,
        createdAt: user.createdAt,
      }),
      ...(seatSummary && { billing: seatSummary }),
    });
  } catch (error) {
    console.error('❌ Erro ao criar usuário:', error);

    // Tratamento de erros do Prisma
    if (error.code === 'P2002') {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Email já está em uso',
      });
    }

    if (error.code === 'P2003') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Supervisor inválido',
      });
    }

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao criar usuário',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * Atualizar dados do usuário (Admin only)
 */
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      role,
      isActive,
      supervisorId,
      organizationAdminId,
      adminSeatLimit,
      adminExtraSeatPrice,
      adminPlanCode,
      adminPlanName,
      adminPlanMonthlyPrice,
      adminPlanStatus,
    } = req.body;

    // Validar se usuário existe
    const existingUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!existingUser) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Usuário não encontrado',
      });
    }

    // Validações
    if (role && !ALL_ROLES.includes(role)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Role inválida. Valores aceitos: ${ALL_ROLES.join(', ')}`,
      });
    }

    const actorIsSuperAdmin = req.user.role === 'SUPERADMIN';
    const nextRole = role || existingUser.role;
    const parsedIsActive = parseOptionalBoolean(isActive);

    if (parsedIsActive.provided && parsedIsActive.value === null) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'isActive invalido. Use true ou false.',
      });
    }

    const nextIsActive = parsedIsActive.provided
      ? parsedIsActive.value
      : existingUser.isActive;

    if (
      req.user.role === 'ADMIN' &&
      existingUser.id !== req.user.id &&
      existingUser.organizationAdminId !== req.user.id
    ) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você só pode editar usuários do seu próprio time',
      });
    }

    if (req.user.role === 'ADMIN' && role && !TEAM_MEMBER_ROLES.includes(role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Admin só pode definir papéis do time (HR, SUPERVISOR, MEMBER)',
      });
    }

    if (
      parsedIsActive.provided &&
      !TEAM_MEMBER_ROLES.includes(existingUser.role)
    ) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Somente usuarios do time (HR, SUPERVISOR, MEMBER) podem ser desativados/reativados.',
      });
    }

    if (parsedIsActive.provided && nextIsActive === false && existingUser.id === req.user.id) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Voce nao pode desativar sua propria conta.',
      });
    }

    if (role === 'SUPERADMIN' && !actorIsSuperAdmin) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Apenas SUPERADMIN pode atribuir papel SUPERADMIN',
      });
    }

    if (role === 'ADMIN' && !actorIsSuperAdmin) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Apenas SUPERADMIN pode atribuir papel ADMIN',
      });
    }

    if (name && name.trim().length < 2) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Nome deve ter pelo menos 2 caracteres',
      });
    }

    // Validar supervisor
    if (supervisorId) {
      const supervisor = await prisma.user.findUnique({
        where: { id: supervisorId },
      });

      if (!supervisor) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Supervisor não encontrado',
        });
      }

      if (!['SUPERADMIN', 'ADMIN', 'HR', 'SUPERVISOR'].includes(supervisor.role)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Apenas Admin ou Supervisor podem ser atribuídos como supervisores',
        });
      }

      if (
        req.user.role === 'ADMIN' &&
        supervisor.id !== req.user.id &&
        supervisor.organizationAdminId !== req.user.id
      ) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Supervisor deve pertencer ao seu time de administração',
        });
      }

      // Prevenir hierarquia circular
      if (supervisorId === id) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Um usuário não pode ser supervisor de si mesmo',
        });
      }
    }

    let nextOrganizationAdminId = existingUser.organizationAdminId;

    if (nextRole === 'SUPERADMIN') {
      nextOrganizationAdminId = null;
    } else if (nextRole === 'ADMIN') {
      if (organizationAdminId !== undefined && organizationAdminId !== id) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Usuário ADMIN deve ser vinculado ao próprio ID como owner de organização',
        });
      }
      nextOrganizationAdminId = id;
    } else {
      if (existingUser.role === 'ADMIN' && organizationAdminId === undefined) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Ao remover papel ADMIN, informe organizationAdminId de um novo administrador responsável.',
        });
      }

      if (organizationAdminId !== undefined) {
        if (!actorIsSuperAdmin) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'Apenas SUPERADMIN pode alterar organizationAdminId de outros usuários',
          });
        }

        if (!organizationAdminId) {
          return res.status(400).json({
            error: 'Bad Request',
            message: 'organizationAdminId é obrigatório para usuários não SUPERADMIN',
          });
        }

        const orgAdmin = await prisma.user.findUnique({
          where: { id: organizationAdminId },
          select: { id: true, role: true, adminPlanId: true },
        });

        if (!orgAdmin || orgAdmin.role !== 'ADMIN') {
          return res.status(404).json({
            error: 'Not Found',
            message: 'Administrador responsável não encontrado para vinculação',
          });
        }

        if (!orgAdmin.adminPlanId) {
          return res.status(400).json({
            error: 'Bad Request',
            message: 'O administrador responsável não possui plano vinculado',
          });
        }

        nextOrganizationAdminId = orgAdmin.id;
      }

      if (!nextOrganizationAdminId) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Cada usuário não SUPERADMIN deve estar vinculado a um ADMIN',
        });
      }
    }

    let adminSeatConfigData = {};
    let adminPlanConfigData = {};

    if (nextRole === 'ADMIN') {
      const hasAdminConfigChangeRequest =
        adminSeatLimit !== undefined ||
        adminExtraSeatPrice !== undefined ||
        adminPlanCode !== undefined ||
        adminPlanName !== undefined ||
        adminPlanMonthlyPrice !== undefined ||
        adminPlanStatus !== undefined;

      if (hasAdminConfigChangeRequest && !actorIsSuperAdmin) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Apenas SUPERADMIN pode alterar configuração de plano/cadeiras de ADMIN',
        });
      }

      if (
        adminSeatLimit !== undefined ||
        adminExtraSeatPrice !== undefined ||
        existingUser.adminSeatLimit === null ||
        existingUser.adminSeatLimit === undefined
      ) {
        const seatConfig = resolveAdminSeatConfig({
          adminSeatLimit:
            adminSeatLimit === undefined ? existingUser.adminSeatLimit : adminSeatLimit,
          adminExtraSeatPrice:
            adminExtraSeatPrice === undefined
              ? existingUser.adminExtraSeatPrice
              : adminExtraSeatPrice,
        });

        if (seatConfig.error) {
          return res.status(400).json({
            error: 'Bad Request',
            message: seatConfig.error,
          });
        }

        adminSeatConfigData = {
          adminSeatLimit: seatConfig.adminSeatLimit,
          adminExtraSeatPrice: seatConfig.adminExtraSeatPrice,
        };
      }

      const normalizedPlanStatus = normalizeAdminPlanStatus(
        adminPlanStatus,
        existingUser.adminPlanStatus || 'INACTIVE'
      );

      if (!normalizedPlanStatus) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `adminPlanStatus inválido. Valores aceitos: ${ADMIN_PLAN_STATUSES.join(', ')}`,
        });
      }

      let nextAdminPlanId = existingUser.adminPlanId;
      if (
        adminPlanCode !== undefined ||
        adminPlanName !== undefined ||
        adminPlanMonthlyPrice !== undefined ||
        !nextAdminPlanId
      ) {
        const planRecord = await ensureAdminPlanRecord({
          code: adminPlanCode,
          name: adminPlanName,
          monthlyPrice: adminPlanMonthlyPrice,
        });

        if (planRecord.error) {
          return res.status(400).json({
            error: 'Bad Request',
            message: planRecord.error,
          });
        }

        nextAdminPlanId = planRecord.plan.id;
      }

      adminPlanConfigData = {
        adminPlanId: nextAdminPlanId,
        adminPlanStatus: normalizedPlanStatus,
        adminPlanLinkedAt: existingUser.adminPlanLinkedAt || new Date(),
      };
    } else {
      if (
        (adminSeatLimit !== undefined || adminExtraSeatPrice !== undefined) &&
        !actorIsSuperAdmin
      ) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Apenas SUPERADMIN pode alterar configuração de cadeiras de ADMIN',
        });
      }

      adminPlanConfigData = {
        adminPlanId: null,
        adminPlanStatus: 'INACTIVE',
        adminPlanLinkedAt: null,
      };

      if (existingUser.role === 'ADMIN') {
        adminSeatConfigData = {
          adminSeatLimit: null,
          adminExtraSeatPrice: null,
          adminActiveSeats: 0,
          adminExtraSeatsContracted: 0,
        };
      }
    }

    const adminIdsToSync = Array.from(
      new Set(
        [
          existingUser.role === 'ADMIN' ? existingUser.id : null,
          existingUser.organizationAdminId,
          nextRole === 'ADMIN' ? id : null,
          nextOrganizationAdminId,
        ].filter(Boolean)
      )
    );

    // Atualiza usuário
    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        ...(name && { name: name.trim() }),
        role: nextRole,
        ...(nextIsActive !== existingUser.isActive && { isActive: nextIsActive }),
        ...(supervisorId !== undefined && { supervisorId }),
        organizationAdminId: nextOrganizationAdminId,
        ...adminSeatConfigData,
        ...adminPlanConfigData,
      },
      include: {
        supervisor: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
        organizationAdmin: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
        adminPlan: {
          select: {
            id: true,
            code: true,
            name: true,
            monthlyPrice: true,
            isActive: true,
          },
        },
      },
    });

    const syncedSeatSnapshots = {};
    for (const adminId of adminIdsToSync) {
      try {
        const snapshot = await syncAdminSeatSnapshot(adminId);
        if (snapshot) {
          syncedSeatSnapshots[adminId] = snapshot;
        }
      } catch (syncError) {
        console.warn('⚠️ Falha ao sincronizar snapshot de cadeiras após atualização:', syncError.message);
      }
    }

    let seatValidation = null;
    if (updatedUser.role === 'ADMIN') {
      const snapshot =
        syncedSeatSnapshots[updatedUser.id] ||
        buildPersistedAdminSeatSnapshot({
          planCode: updatedUser.adminPlan?.code,
          seatLimit: updatedUser.adminSeatLimit,
          occupiedSeats: updatedUser.adminActiveSeats,
        });

      seatValidation = {
        seatLimit: snapshot.seatLimit,
        occupiedSeats: snapshot.activeSeats,
        overageSeats: snapshot.overageSeats,
        contractedExtraSeats: snapshot.contractedExtraSeats,
        requiresDownsizeOrUpgrade: snapshot.overageSeats > 0,
        message:
          snapshot.overageSeats > 0
            ? `O ADMIN ficou com ${snapshot.overageSeats} cadeira(s) excedente(s). Ele precisa remover membros do time ou contratar cadeiras adicionais.`
            : 'Configuracao de cadeiras valida para o tamanho atual do time.',
      };
    }

    // Atualiza metadados no Supabase quando houver alteração relevante
    const shouldSyncMetadata =
      role !== undefined ||
      name !== undefined ||
      nextIsActive !== existingUser.isActive ||
      nextOrganizationAdminId !== existingUser.organizationAdminId;

    if (shouldSyncMetadata) {
      await supabaseAdmin.auth.admin.updateUserById(id, {
        user_metadata: {
          name: updatedUser.name,
          role: updatedUser.role,
          organizationAdminId: updatedUser.organizationAdminId,
          isActive: updatedUser.isActive,
        },
      });
    }

    console.log(`✅ Usuário atualizado: ${updatedUser.email}`);

    res.json({
      message: 'Usuário atualizado com sucesso',
      user: withPhotoUrl(req, {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
        organizationAdminId: updatedUser.organizationAdminId,
        organizationAdmin: updatedUser.organizationAdmin,
        adminSeatLimit: updatedUser.adminSeatLimit,
        adminExtraSeatPrice: updatedUser.adminExtraSeatPrice,
        adminActiveSeats: syncedSeatSnapshots[updatedUser.id]?.activeSeats ?? updatedUser.adminActiveSeats,
        adminExtraSeatsContracted:
          syncedSeatSnapshots[updatedUser.id]?.contractedExtraSeats ?? updatedUser.adminExtraSeatsContracted,
        adminPlanStatus: updatedUser.adminPlanStatus,
        adminPlanLinkedAt: updatedUser.adminPlanLinkedAt,
        adminPlan: updatedUser.adminPlan,
        supervisor: updatedUser.supervisor,
        createdAt: updatedUser.createdAt,
      }),
      ...(seatValidation && { seatValidation }),
    });
  } catch (error) {
    console.error('❌ Erro ao atualizar usuário:', error);

    if (error.code === 'P2003') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Supervisor inválido',
      });
    }

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao atualizar usuário',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * Listar todos os usuários (Admin/HR/Supervisor)
 */
const listUsers = async (req, res) => {
  try {
    const { role, search, page = 1, limit = 50, organizationAdminId, activeOnly } = req.query;
    const shouldFilterActiveOnly = /^(1|true|yes|on)$/i.test(String(activeOnly || ''));

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};

    // Filtro por role
    if (role && ALL_ROLES.includes(role)) {
      where.role = role;
    }

    // Filtro por busca (nome ou email)
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (organizationAdminId && typeof organizationAdminId === 'string') {
      const normalizedOrgAdminId = organizationAdminId.trim();
      if (normalizedOrgAdminId) {
        where.AND = [
          ...(where.AND || []),
          {
            OR: [{ id: normalizedOrgAdminId }, { organizationAdminId: normalizedOrgAdminId }],
          },
        ];
      }
    }

    if (shouldFilterActiveOnly) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { role: 'SUPERADMIN' },
            { role: 'ADMIN', adminPlanStatus: 'ACTIVE' },
            {
              role: { in: TEAM_MEMBER_ROLES },
              organizationAdmin: {
                is: {
                  adminPlanStatus: 'ACTIVE',
                },
              },
            },
          ],
        },
      ];
    }

    const accessFilters = [];

    // Se for supervisor, só mostra seus subordinados.
    if (req.user.role === 'SUPERVISOR') {
      accessFilters.push({ supervisorId: req.user.id });
    }

    // ADMIN visualiza apenas seu próprio time e a si mesmo.
    if (req.user.role === 'ADMIN') {
      accessFilters.push({ OR: [{ id: req.user.id }, { organizationAdminId: req.user.id }] });
    }

    if (accessFilters.length > 0) {
      where.AND = [...(where.AND || []), ...accessFilters];
    }

    const baseUserSelect = {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      photoPath: true,
      photoUpdatedAt: true,
      contractDailyMinutes: true,
      workdayStartTime: true,
      workdayEndTime: true,
      hourlyRate: true,
      timeZone: true,
      organizationAdminId: true,
      adminPlanStatus: true,
      adminPlanLinkedAt: true,
      supervisor: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
        },
      },
      organizationAdmin: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
        },
      },
      adminPlan: {
        select: {
          id: true,
          code: true,
          name: true,
          monthlyPrice: true,
          isActive: true,
        },
      },
      createdAt: true,
    };

    let users;
    try {
      users = await prisma.user.findMany({
        where,
        select: {
          ...baseUserSelect,
          phone: true,
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      if (!isUnknownPhoneSelectError(error)) {
        throw error;
      }

      console.warn('⚠️ Prisma client sem campo phone. Aplicando fallback de listUsers sem phone.');

      users = await prisma.user.findMany({
        where,
        select: baseUserSelect,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      });
    }

    const total = await prisma.user.count({ where });

    const usersWithPhoto = users.map((user) => withPhotoUrl(req, user));

    res.json({
      users: usersWithPhoto,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('❌ Erro ao listar usuários:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao listar usuários',
    });
  }
};

/**
 * Obter usuário por ID
 */
const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        phone: true,
        photoPath: true,
        photoUpdatedAt: true,
        contractDailyMinutes: true,
        workdayStartTime: true,
        workdayEndTime: true,
        hourlyRate: true,
        timeZone: true,
        bankHoursBalanceMinutes: true,
        bankHoursLimitMinutes: true,
        bankHoursExpiryMonths: true,
        bankHoursPolicyCode: true,
        createdAt: true,
        supervisorId: true,
        organizationAdminId: true,
        adminSeatLimit: true,
        adminExtraSeatPrice: true,
        adminActiveSeats: true,
        adminExtraSeatsContracted: true,
        adminPlanId: true,
        adminPlanStatus: true,
        adminPlanLinkedAt: true,
        organizationAdmin: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
        supervisor: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
        adminPlan: {
          select: {
            id: true,
            code: true,
            name: true,
            monthlyPrice: true,
            isActive: true,
          },
        },
        subordinates: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isActive: true,
          },
        },
        _count: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Usuário não encontrado',
      });
    }

    // Supervisor só pode ver seus subordinados
    if (req.user.role === 'SUPERVISOR' && user.supervisorId !== req.user.id && user.id !== req.user.id) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você não tem permissão para visualizar este usuário',
      });
    }

    if (
      req.user.role === 'ADMIN' &&
      user.id !== req.user.id &&
      user.organizationAdminId !== req.user.id
    ) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você não tem permissão para visualizar este usuário',
      });
    }

    res.json({ user: withPhotoUrl(req, user) });
  } catch (error) {
    console.error('❌ Erro ao buscar usuário:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar usuário',
    });
  }
};

/**
 * Listar mapa de cadeiras por admin
 * SUPERADMIN: todos os admins
 * ADMIN: apenas suas próprias cadeiras
 * HR: cadeiras do admin responsável pelo seu time
 */
const listAdminSeatAssignments = async (req, res) => {
  try {
    const baseAdminWhere = { role: 'ADMIN' };

    if (req.user.role === 'ADMIN') {
      baseAdminWhere.id = req.user.id;
    }

    if (req.user.role === 'HR' || req.user.role === 'SUPERVISOR' || req.user.role === 'MEMBER') {
      const currentUser = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { organizationAdminId: true },
      });

      if (!currentUser?.organizationAdminId) {
        return res.json({ admins: [] });
      }

      baseAdminWhere.id = currentUser.organizationAdminId;
    }

    const admins = await prisma.user.findMany({
      where: baseAdminWhere,
      select: {
        id: true,
        name: true,
        email: true,
        adminSeatLimit: true,
        adminExtraSeatPrice: true,
        adminActiveSeats: true,
        adminExtraSeatsContracted: true,
        adminPlanStatus: true,
        adminPlanLinkedAt: true,
        adminPlan: {
          select: {
            id: true,
            code: true,
            name: true,
            monthlyPrice: true,
            isActive: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const adminIds = admins.map((admin) => admin.id);
    if (adminIds.length === 0) {
      return res.json({ admins: [] });
    }

    const members = await prisma.user.findMany({
      where: {
        organizationAdminId: { in: adminIds },
        role: { in: TEAM_MEMBER_ROLES },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        organizationAdminId: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const activeMembersByAdmin = members.reduce((acc, member) => {
      const ownerId = member.organizationAdminId;
      if (!ownerId || member.isActive === false) return acc;
      if (!acc[ownerId]) acc[ownerId] = [];
      acc[ownerId].push(member);
      return acc;
    }, {});

    const inactiveMembersByAdmin = members.reduce((acc, member) => {
      const ownerId = member.organizationAdminId;
      if (!ownerId || member.isActive !== false) return acc;
      if (!acc[ownerId]) acc[ownerId] = [];
      acc[ownerId].push(member);
      return acc;
    }, {});

    const payload = admins.map((admin) => {
      const activeTeamMembers = activeMembersByAdmin[admin.id] || [];
      const inactiveTeamMembers = inactiveMembersByAdmin[admin.id] || [];
      const teamByRole = activeTeamMembers.reduce(
        (acc, member) => {
          acc[member.role] = (acc[member.role] || 0) + 1;
          return acc;
        },
        { HR: 0, SUPERVISOR: 0, MEMBER: 0 }
      );
      const seatLimit = admin.adminSeatLimit;
      const occupiedSeats = activeTeamMembers.length;
      const seatSnapshot = buildPersistedAdminSeatSnapshot({
        planCode: admin.adminPlan?.code,
        seatLimit,
        occupiedSeats,
      });
      const totalSeats = Number.isInteger(seatLimit)
        ? Math.max(seatLimit, occupiedSeats)
        : occupiedSeats;

      const seats = Array.from({ length: totalSeats }, (_, index) => {
        const occupant = activeTeamMembers[index] || null;
        return {
          seatNumber: index + 1,
          occupied: Boolean(occupant),
          occupant,
        };
      });

      return {
        admin: {
          id: admin.id,
          name: admin.name,
          email: admin.email,
        },
        plan: {
          id: admin.adminPlan?.id || null,
          code: admin.adminPlan?.code || null,
          name: admin.adminPlan?.name || null,
          status: admin.adminPlanStatus,
          linkedAt: admin.adminPlanLinkedAt,
          monthlyPriceUsd: admin.adminPlan ? Number(admin.adminPlan.monthlyPrice) : null,
          isCatalogActive: admin.adminPlan?.isActive ?? false,
        },
        billing: {
          seatLimit,
          occupiedSeats,
          activeSeats: seatSnapshot.activeSeats,
          contractedExtraSeats: seatSnapshot.contractedExtraSeats,
          availableSeats: seatSnapshot.availableSeats,
          overageSeats: seatSnapshot.overageSeats,
          extraSeatPriceUsd: Number(admin.adminExtraSeatPrice ?? EXTRA_ADMIN_SEAT_MONTHLY_USD),
        },
        team: {
          totalMembers: activeTeamMembers.length + inactiveTeamMembers.length,
          activeMembers: activeTeamMembers.length,
          inactiveMembers: inactiveTeamMembers.length,
          byRole: teamByRole,
          deactivatedMembers: inactiveTeamMembers,
        },
        seats,
      };
    });

    return res.json({ admins: payload });
  } catch (error) {
    console.error('❌ Erro ao listar cadeiras por admin:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao listar mapa de cadeiras dos admins',
    });
  }
};

/**
 * GET /users/superadmin/accounts-overview
 * Painel consolidado para SUPERADMIN com contas, planos, usuários, MRR e histórico de pagamentos
 */
const listSuperAdminAccountsOverview = async (req, res) => {
  try {
    const paymentHistoryLimit = Math.min(50, toPositiveInteger(req.query.paymentHistoryLimit, 10));
    const stripeLookbackDays = Math.min(3650, toPositiveInteger(req.query.stripeLookbackDays, 365));
    const stripeMaxPages = Math.min(20, toPositiveInteger(req.query.stripeMaxPages, 5));
    const stripePerPage = Math.min(100, toPositiveInteger(req.query.stripePerPage, 100));
    const createdGte = Math.floor(Date.now() / 1000) - stripeLookbackDays * 24 * 60 * 60;

    const planCatalogRows = await prisma.adminPlan.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        monthlyPrice: true,
        isActive: true,
      },
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
    });

    const planCatalogRowsByCode = planCatalogRows.reduce((acc, plan) => {
      const normalizedCode = String(plan.code || '').trim().toUpperCase();
      if (!normalizedCode) return acc;
      acc[normalizedCode] = plan;
      return acc;
    }, {});

    const planCatalog = Object.values(SELF_SERVICE_ADMIN_PLAN_CATALOG).map((catalogPlan) => {
      const dbPlan = planCatalogRowsByCode[catalogPlan.code];

      return {
        id: dbPlan?.id || catalogPlan.code,
        code: catalogPlan.code,
        name: catalogPlan.name,
        monthlyPriceUsd: Number(
          toNumber(dbPlan?.monthlyPrice, catalogPlan.monthlyPrice).toFixed(2)
        ),
        isActive: dbPlan?.isActive ?? true,
      };
    });

    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        adminSeatLimit: true,
        adminExtraSeatPrice: true,
        adminActiveSeats: true,
        adminExtraSeatsContracted: true,
        adminPlanStatus: true,
        adminPlanLinkedAt: true,
        adminPlan: {
          select: {
            id: true,
            code: true,
            name: true,
            monthlyPrice: true,
            isActive: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (admins.length === 0) {
      return res.json({
        generatedAt: new Date().toISOString(),
        stripe: {
          configured: Boolean(process.env.STRIPE_SECRET_KEY),
          reason: process.env.STRIPE_SECRET_KEY ? null : 'STRIPE_NOT_CONFIGURED',
          sessionsScanned: 0,
          lookbackDays: stripeLookbackDays,
        },
        summary: {
          totalAccounts: 0,
          activePlans: 0,
          expiredPlans: 0,
          totalManagedUsers: 0,
          totalUsersIncludingAdmins: 0,
          totalMrrUsd: 0,
        },
        planCatalog,
        accounts: [],
      });
    }

    const adminIds = admins.map((admin) => admin.id);

    const members = await prisma.user.findMany({
      where: {
        organizationAdminId: { in: adminIds },
        role: { in: TEAM_MEMBER_ROLES },
        isActive: true,
      },
      select: {
        id: true,
        role: true,
        organizationAdminId: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const membersByAdmin = members.reduce((acc, member) => {
      if (!member.organizationAdminId) return acc;

      if (!acc[member.organizationAdminId]) {
        acc[member.organizationAdminId] = [];
      }

      acc[member.organizationAdminId].push(member);
      return acc;
    }, {});

    let stripeConfigured = false;
    let stripeReason = null;
    let stripeSessions = [];

    try {
      const stripeResult = await listAdditionalSeatsCheckoutSessions({
        perPage: stripePerPage,
        maxPages: stripeMaxPages,
        createdGte,
      });

      stripeConfigured = stripeResult.ok;
      stripeReason = stripeResult.reason;
      stripeSessions = stripeResult.sessions || [];
    } catch (stripeError) {
      console.error('❌ Erro ao listar sessões Stripe para superadmin:', stripeError);
      stripeConfigured = false;
      stripeReason = stripeError.message || 'STRIPE_LIST_FAILED';
      stripeSessions = [];
    }

    const paymentHistoryByAdmin = stripeSessions.reduce((acc, session) => {
      const adminUserId = session?.metadata?.adminUserId ? String(session.metadata.adminUserId) : null;
      if (!adminUserId) return acc;

      const expectedMonthlyAmountRaw = Number(session?.metadata?.expectedMonthlyAmountUsd);
      const expectedMonthlyAmountUsd = Number.isFinite(expectedMonthlyAmountRaw)
        ? Number(expectedMonthlyAmountRaw.toFixed(2))
        : null;

      const overageSeatsRaw = Number(session?.metadata?.overageSeats);
      const overageSeats = Number.isFinite(overageSeatsRaw)
        ? Math.max(0, Math.floor(overageSeatsRaw))
        : null;

      const paymentRecord = {
        id: session.id,
        createdAt: toIsoFromUnixSeconds(session.created),
        status: session.status || null,
        paymentStatus: session.payment_status || null,
        mode: session.mode || null,
        currency: session.currency ? String(session.currency).toUpperCase() : null,
        amountTotal: fromMinorCurrencyToMajor(session.amount_total),
        amountSubtotal: fromMinorCurrencyToMajor(session.amount_subtotal),
        expectedMonthlyAmountUsd,
        overageSeats,
        customerEmail: session.customer_details?.email || session.customer_email || null,
        subscriptionId:
          typeof session.subscription === 'string' ? session.subscription : session.subscription?.id || null,
        invoiceId: typeof session.invoice === 'string' ? session.invoice : session.invoice?.id || null,
      };

      if (!acc[adminUserId]) {
        acc[adminUserId] = [];
      }

      acc[adminUserId].push(paymentRecord);
      return acc;
    }, {});

    Object.keys(paymentHistoryByAdmin).forEach((adminId) => {
      paymentHistoryByAdmin[adminId].sort((a, b) => {
        if (!a.createdAt || !b.createdAt) return 0;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    });

    const accounts = admins.map((admin) => {
      const teamMembers = membersByAdmin[admin.id] || [];
      const teamByRole = teamMembers.reduce(
        (acc, member) => {
          acc[member.role] = (acc[member.role] || 0) + 1;
          return acc;
        },
        { HR: 0, SUPERVISOR: 0, MEMBER: 0 }
      );

      const seatLimit = admin.adminSeatLimit;
      const occupiedSeats = teamMembers.length;
      const seatSnapshot = buildPersistedAdminSeatSnapshot({
        planCode: admin.adminPlan?.code,
        seatLimit,
        occupiedSeats,
      });

      const overageSeats = seatSnapshot.overageSeats;
      const availableSeats = seatSnapshot.availableSeats;

      const extraSeatPriceUsd = Number(
        toNumber(admin.adminExtraSeatPrice, EXTRA_ADMIN_SEAT_MONTHLY_USD).toFixed(2)
      );
      const planMonthlyPriceUsd = admin.adminPlan
        ? Number(toNumber(admin.adminPlan.monthlyPrice, 0).toFixed(2))
        : 0;
      const isActivePlan = admin.adminPlanStatus === 'ACTIVE';

      const basePlanUsd = isActivePlan ? planMonthlyPriceUsd : 0;
      const overageUsd = isActivePlan
        ? Number((overageSeats * extraSeatPriceUsd).toFixed(2))
        : 0;
      const totalUsd = Number((basePlanUsd + overageUsd).toFixed(2));

      return {
        admin: {
          id: admin.id,
          name: admin.name,
          email: admin.email,
          createdAt: admin.createdAt,
        },
        plan: {
          id: admin.adminPlan?.id || null,
          code: admin.adminPlan?.code || null,
          name: admin.adminPlan?.name || null,
          status: admin.adminPlanStatus,
          linkedAt: admin.adminPlanLinkedAt,
          monthlyPriceUsd: planMonthlyPriceUsd,
          isCatalogActive: admin.adminPlan?.isActive ?? false,
        },
        users: {
          managedUsers: occupiedSeats,
          totalUsersIncludingAdmin: occupiedSeats + 1,
          byRole: teamByRole,
        },
        billing: {
          seatLimit,
          occupiedSeats,
          activeSeats: seatSnapshot.activeSeats,
          contractedExtraSeats: seatSnapshot.contractedExtraSeats,
          availableSeats,
          overageSeats,
          extraSeatPriceUsd,
        },
        mrr: {
          active: isActivePlan,
          basePlanUsd,
          overageUsd,
          totalUsd,
        },
        paymentHistory: (paymentHistoryByAdmin[admin.id] || []).slice(0, paymentHistoryLimit),
      };
    });

    const summary = accounts.reduce(
      (acc, account) => {
        acc.totalAccounts += 1;
        if (account.plan.status === 'ACTIVE') {
          acc.activePlans += 1;
        } else {
          acc.expiredPlans += 1;
        }

        acc.totalManagedUsers += account.users.managedUsers;
        acc.totalUsersIncludingAdmins += account.users.totalUsersIncludingAdmin;
        acc.totalMrrUsd = Number((acc.totalMrrUsd + account.mrr.totalUsd).toFixed(2));
        return acc;
      },
      {
        totalAccounts: 0,
        activePlans: 0,
        expiredPlans: 0,
        totalManagedUsers: 0,
        totalUsersIncludingAdmins: 0,
        totalMrrUsd: 0,
      }
    );

    return res.json({
      generatedAt: new Date().toISOString(),
      stripe: {
        configured: stripeConfigured,
        reason: stripeReason,
        sessionsScanned: stripeSessions.length,
        lookbackDays: stripeLookbackDays,
      },
      summary,
      planCatalog,
      accounts,
    });
  } catch (error) {
    console.error('❌ Erro ao listar visão superadmin de contas:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao listar visão consolidada das contas para superadmin',
    });
  }
};

/**
 * GET /users/me/profile-complete
 * Retorna perfil completo do usuário autenticado
 */
const getMyCompleteProfile = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        phone: true,
        photoPath: true,
        photoUpdatedAt: true,
        contractDailyMinutes: true,
        workdayStartTime: true,
        workdayEndTime: true,
        hourlyRate: true,
        timeZone: true,
        bankHoursBalanceMinutes: true,
        bankHoursLimitMinutes: true,
        bankHoursExpiryMonths: true,
        bankHoursPolicyCode: true,
        createdAt: true,
        supervisorId: true,
        organizationAdminId: true,
        adminSeatLimit: true,
        adminExtraSeatPrice: true,
        adminActiveSeats: true,
        adminExtraSeatsContracted: true,
        adminPlanId: true,
        adminPlanStatus: true,
        adminPlanLinkedAt: true,
        supervisor: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        organizationAdmin: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
        adminPlan: {
          select: {
            id: true,
            code: true,
            name: true,
            monthlyPrice: true,
            isActive: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Usuário não encontrado',
      });
    }

    return res.json({ user: withPhotoUrl(req, user) });
  } catch (error) {
    console.error('❌ Erro ao buscar perfil completo:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar perfil completo',
    });
  }
};

/**
 * PATCH /users/me/account
 * Atualiza dados da conta do usuario autenticado
 */
const updateMyAccount = async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    if (name === undefined && email === undefined && password === undefined && phone === undefined) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Informe ao menos um campo para atualizar: name, email, phone ou password.',
      });
    }

    const normalizedName = name !== undefined ? String(name).trim() : undefined;
    const normalizedEmail = email !== undefined ? String(email).trim().toLowerCase() : undefined;
    const normalizedPassword = password !== undefined ? String(password) : undefined;
    const normalizedPhone = phone !== undefined ? String(phone || '').trim() : undefined;

    if (normalizedName !== undefined && normalizedName.length < 2) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Nome deve ter pelo menos 2 caracteres',
      });
    }

    if (normalizedEmail !== undefined) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(normalizedEmail)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Email invalido',
        });
      }
    }

    if (normalizedPassword !== undefined && normalizedPassword.length > 0) {
      const passwordValidationError = validateStrongPassword(normalizedPassword);
      if (passwordValidationError) {
        return res.status(400).json({
          error: 'Bad Request',
          message: passwordValidationError,
        });
      }
    }

    if (normalizedPhone !== undefined && normalizedPhone.length > 0 && normalizedPhone.length < 3) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Telefone invalido',
      });
    }

    if (normalizedEmail !== undefined && normalizedEmail !== req.user.email) {
      const existingUserWithEmail = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true },
      });

      if (existingUserWithEmail && existingUserWithEmail.id !== req.user.id) {
        return res.status(409).json({
          error: 'Conflict',
          message: 'Ja existe um usuario com este email',
        });
      }
    }

    const nextName = normalizedName !== undefined ? normalizedName : req.user.name;
    const nextPhone = normalizedPhone !== undefined ? normalizedPhone : req.user.phone;

    const supabasePayload = {
      ...(normalizedEmail !== undefined ? { email: normalizedEmail } : {}),
      ...(normalizedPassword !== undefined && normalizedPassword.length > 0
        ? { password: normalizedPassword }
        : {}),
      user_metadata: {
        name: nextName,
        role: req.user.role,
        phone: nextPhone || null,
      },
    };

    const { error: supabaseError } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, supabasePayload);

    if (supabaseError) {
      return res.status(400).json({
        error: 'Bad Request',
        message: supabaseError.message || 'Erro ao atualizar usuario no sistema de autenticacao',
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(normalizedName !== undefined ? { name: normalizedName } : {}),
        ...(normalizedEmail !== undefined ? { email: normalizedEmail } : {}),
        ...(normalizedPhone !== undefined ? { phone: normalizedPhone || null } : {}),
      },
      include: {
        supervisor: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    return res.json({
      message: 'Dados da conta atualizados com sucesso.',
      user: withPhotoUrl(req, updatedUser),
    });
  } catch (error) {
    console.error('❌ Erro ao atualizar conta do usuario:', error);

    if (error.code === 'P2002') {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Ja existe um usuario com este email',
      });
    }

    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao atualizar dados da conta',
    });
  }
};

/**
 * POST /users/me/team-invite-link
 * Gera link de convite para o ADMIN convidar funcionarios para o proprio time.
 */
const createMyTeamInviteLink = async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Apenas ADMIN pode gerar convite de equipe.',
      });
    }

    const { role, expiresInHours } = req.body || {};
    const normalizedRole = String(role || '').trim().toUpperCase();

    if (!INVITABLE_ROLES.includes(normalizedRole)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `role invalida. Valores aceitos: ${INVITABLE_ROLES.join(', ')}`,
      });
    }

    const adminOwner = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        role: true,
        adminSeatLimit: true,
        adminExtraSeatPrice: true,
        adminPlanId: true,
      },
    });

    if (!adminOwner || adminOwner.role !== 'ADMIN') {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Conta ADMIN nao encontrada.',
      });
    }

    if (!adminOwner.adminPlanId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Nao e possivel gerar convite sem plano ADMIN ativo/vinculado.',
      });
    }

    const currentTeamSize = await prisma.user.count({
      where: {
        organizationAdminId: req.user.id,
        role: { in: TEAM_MEMBER_ROLES },
        isActive: true,
      },
    });

    const seatSummary = buildSeatSummary({
      adminUser: adminOwner,
      currentTeamSize,
      nextTeamSize: currentTeamSize + 1,
    });

    if (seatSummary.requiresPayment) {
      const requiredAdditionalSeats = Math.max(1, seatSummary.overageSeats);
      const purchaseUrl = buildFrontendAppUrl(
        `/app/admin/comprar-assentos?required=${requiredAdditionalSeats}`
      );

      return res.status(409).json({
        error: 'Conflict',
        code: 'NO_AVAILABLE_SEATS',
        message: 'Nao ha mais assentos disponiveis para gerar novos convites.',
        seatAvailability: {
          seatLimit: seatSummary.seatLimit,
          occupiedSeats: currentTeamSize,
          availableSeats: resolveSeatAvailability({
            seatSummary,
            occupiedSeats: currentTeamSize,
          }),
          requiredAdditionalSeats,
        },
        purchase: {
          url: purchaseUrl,
          suggestedQuantity: requiredAdditionalSeats,
        },
      });
    }

    const invite = issueTeamInviteToken({
      adminId: req.user.id,
      role: normalizedRole,
      issuedById: req.user.id,
      expiresInHours,
    });

    const inviteUrl = buildFrontendAppUrl(`/signup?invite=${encodeURIComponent(invite.token)}`);

    return res.status(201).json({
      message: 'Link de convite gerado com sucesso.',
      invite: {
        role: normalizedRole,
        expiresAt: invite.expiresAt,
        ttlHours: invite.ttlHours,
        token: invite.token,
        url: inviteUrl,
      },
    });
  } catch (error) {
    console.error('❌ Erro ao gerar link de convite da equipe:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao gerar convite da equipe',
    });
  }
};

/**
 * POST /users/me/additional-seats/checkout
 * Inicia checkout Stripe para compra manual de cadeiras adicionais.
 */
const createMyAdditionalSeatsCheckout = async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Apenas ADMIN pode comprar cadeiras adicionais.',
      });
    }

    const quantityRaw = req.body?.quantity;
    const quantity = Number(quantityRaw);

    if (!Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'quantity deve ser um numero inteiro maior ou igual a 1.',
      });
    }

    if (quantity > 500) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'quantity nao pode ser maior que 500 por checkout.',
      });
    }

    const adminOwner = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        role: true,
        adminPlanId: true,
        adminExtraSeatPrice: true,
      },
    });

    if (!adminOwner || adminOwner.role !== 'ADMIN') {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Conta ADMIN nao encontrada.',
      });
    }

    if (!adminOwner.adminPlanId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Nao e possivel comprar cadeiras adicionais sem plano vinculado.',
      });
    }

    const unitPriceUsd = Number(
      toNumber(adminOwner.adminExtraSeatPrice, EXTRA_ADMIN_SEAT_MONTHLY_USD).toFixed(2)
    );
    const monthlyTotalUsd = Number((quantity * unitPriceUsd).toFixed(2));

    const checkout = await createAdditionalSeatsCheckoutSession({
      adminUserId: adminOwner.id,
      adminEmail: adminOwner.email || req.user.email,
      overageSeats: quantity,
      amountDue: monthlyTotalUsd,
    });

    if (!checkout.ok || !checkout.checkoutUrl) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Checkout Stripe de cadeiras adicionais nao configurado no backend.',
        reason: checkout.reason || 'STRIPE_NOT_CONFIGURED',
      });
    }

    return res.status(201).json({
      message: 'Checkout de cadeiras adicionais iniciado com sucesso.',
      billing: {
        requestedSeats: quantity,
        unitPriceUsd,
        monthlyTotalUsd,
      },
      stripe: {
        configured: true,
        checkoutUrl: checkout.checkoutUrl,
        sessionId: checkout.sessionId || null,
        quantity: checkout.quantity || quantity,
        currency: 'usd',
      },
    });
  } catch (error) {
    console.error('❌ Erro ao iniciar checkout manual de cadeiras adicionais:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao iniciar checkout de cadeiras adicionais',
    });
  }
};

/**
 * PATCH /users/me/plan
 * Permite que o ADMIN escolha plano e quantidade de cadeiras para a propria conta.
 */
const chooseMyPlan = async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Apenas ADMIN pode escolher o proprio plano.',
      });
    }

    const { planCode, seatLimit, seats, startCheckout, stripeSessionId, returnTo } = req.body || {};
    const shouldStartCheckout = parseBooleanFlag(startCheckout);
    const safeReturnTo = resolveAppReturnPath(returnTo, '/app');

    let selectedPlan;
    let requestedSeatLimit;

    if (stripeSessionId) {
      const verification = await verifyBasePlanCheckoutSession({
        sessionId: stripeSessionId,
        adminUserId: req.user.id,
      });

      if (!verification.ok) {
        if (verification.reason === 'STRIPE_NOT_CONFIGURED') {
          return res.status(409).json({
            error: 'Conflict',
            message: 'Checkout Stripe nao configurado no backend.',
            reason: verification.reason,
          });
        }

        if (verification.reason === 'ADMIN_MISMATCH') {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'Sessao de checkout nao pertence ao ADMIN autenticado.',
            reason: verification.reason,
          });
        }

        if (verification.reason === 'SESSION_NOT_PAID') {
          return res.status(402).json({
            error: 'Payment Required',
            message: 'Sessao Stripe ainda nao foi concluida/paga.',
            reason: verification.reason,
            status: verification.status,
            paymentStatus: verification.paymentStatus,
          });
        }

        return res.status(400).json({
          error: 'Bad Request',
          message: 'Sessao Stripe invalida para ativacao do plano.',
          reason: verification.reason,
        });
      }

      selectedPlan = SELF_SERVICE_ADMIN_PLAN_CATALOG[verification.planCode];
      requestedSeatLimit = verification.seatLimit;

      if (!selectedPlan) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Plano retornado pelo Stripe nao e suportado.',
        });
      }

    } else {
      const selection = resolveSelfServicePlanSelection({ planCode, seatLimit, seats });

      if (selection.error) {
        return res.status(400).json({
          error: 'Bad Request',
          message: selection.error,
        });
      }

      selectedPlan = selection.selectedPlan;
      requestedSeatLimit = selection.requestedSeatLimit;
      const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);

      if (stripeConfigured && !shouldStartCheckout) {
        return res.status(402).json({
          error: 'Payment Required',
          message: 'Conclua o checkout Stripe para ativar o plano selecionado.',
          reason: 'CHECKOUT_REQUIRED',
        });
      }

      if (shouldStartCheckout) {
        const checkout = await createBasePlanCheckoutSession({
          adminUserId: req.user.id,
          adminEmail: req.user.email,
          planCode: selectedPlan.code,
          planName: selectedPlan.name,
          planMonthlyPriceUsd: selectedPlan.monthlyPrice,
          seatLimit: requestedSeatLimit,
          returnTo: safeReturnTo,
        });

        if (!checkout.ok || !checkout.checkoutUrl) {
          const messageByReason = {
            STRIPE_NOT_CONFIGURED: 'Checkout Stripe nao configurado no backend.',
            STRIPE_PLAN_NOT_CONFIGURED: `Preco Stripe do plano ${selectedPlan.code} nao configurado no backend.`,
          };

          return res.status(409).json({
            error: 'Conflict',
            message:
              messageByReason[checkout.reason] ||
              'Nao foi possivel iniciar checkout Stripe para o plano selecionado.',
            reason: checkout.reason || 'STRIPE_CHECKOUT_NOT_AVAILABLE',
          });
        }

        return res.status(202).json({
          message: 'Checkout Stripe iniciado. Redirecione o usuario para concluir a compra.',
          checkout: {
            url: checkout.checkoutUrl,
            sessionId: checkout.sessionId,
            provider: 'STRIPE',
            returnTo: safeReturnTo,
          },
          planSelection: {
            code: selectedPlan.code,
            name: selectedPlan.name,
            monthlyPriceUsd: Number(selectedPlan.monthlyPrice.toFixed(2)),
            seatLimit: requestedSeatLimit,
            maxSeats: selectedPlan.maxSeats,
            status: 'INACTIVE',
          },
        });
      }
    }

    const planRecord = await ensureAdminPlanRecord({
      code: selectedPlan.code,
      name: selectedPlan.name,
      monthlyPrice: selectedPlan.monthlyPrice,
    });

    if (planRecord.error) {
      return res.status(400).json({
        error: 'Bad Request',
        message: planRecord.error,
      });
    }

    const occupiedSeats = await prisma.user.count({
      where: {
        organizationAdminId: req.user.id,
        role: { in: TEAM_MEMBER_ROLES },
        isActive: true,
      },
    });

    const seatSnapshot = buildPersistedAdminSeatSnapshot({
      planCode: selectedPlan.code,
      seatLimit: requestedSeatLimit,
      occupiedSeats,
    });

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        adminPlanId: planRecord.plan.id,
        adminPlanStatus: 'ACTIVE',
        adminPlanLinkedAt: new Date(),
        adminSeatLimit: requestedSeatLimit,
        adminExtraSeatPrice: Number(EXTRA_ADMIN_SEAT_MONTHLY_USD.toFixed(2)),
        adminActiveSeats: seatSnapshot.activeSeats,
        adminExtraSeatsContracted: seatSnapshot.contractedExtraSeats,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        photoPath: true,
        photoUpdatedAt: true,
        organizationAdminId: true,
        adminSeatLimit: true,
        adminExtraSeatPrice: true,
        adminActiveSeats: true,
        adminExtraSeatsContracted: true,
        adminPlanStatus: true,
        adminPlanLinkedAt: true,
        adminPlan: {
          select: {
            id: true,
            code: true,
            name: true,
            monthlyPrice: true,
            isActive: true,
          },
        },
      },
    });

    return res.json({
      message: 'Plano atualizado com sucesso.',
      planSelection: {
        code: selectedPlan.code,
        name: selectedPlan.name,
        monthlyPriceUsd: Number(selectedPlan.monthlyPrice.toFixed(2)),
        seatLimit: updatedUser.adminSeatLimit,
        maxSeats: selectedPlan.maxSeats,
        activeSeats: updatedUser.adminActiveSeats,
        contractedExtraSeats: updatedUser.adminExtraSeatsContracted,
        status: updatedUser.adminPlanStatus,
      },
      user: withPhotoUrl(req, {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
        photoPath: updatedUser.photoPath,
        photoUpdatedAt: updatedUser.photoUpdatedAt,
        organizationAdminId: updatedUser.organizationAdminId,
        adminSeatLimit: updatedUser.adminSeatLimit,
        adminExtraSeatPrice: updatedUser.adminExtraSeatPrice,
        adminActiveSeats: updatedUser.adminActiveSeats,
        adminExtraSeatsContracted: updatedUser.adminExtraSeatsContracted,
        adminPlanStatus: updatedUser.adminPlanStatus,
        adminPlanLinkedAt: updatedUser.adminPlanLinkedAt,
        adminPlan: updatedUser.adminPlan,
      }),
    });
  } catch (error) {
    console.error('❌ Erro ao escolher plano do ADMIN:', error);

    if (error.code === 'P2025') {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Usuario ADMIN nao encontrado.',
      });
    }

    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao selecionar plano da conta',
    });
  }
};

/**
 * PATCH /users/me/additional-seats/confirm
 * Confirma checkout de cadeiras adicionais no Stripe e persiste snapshot no banco.
 */
const confirmAdditionalSeatsCheckout = async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Apenas ADMIN pode confirmar checkout de cadeiras adicionais.',
      });
    }

    const { stripeSessionId } = req.body || {};

    const verification = await verifyAdditionalSeatsCheckoutSession({
      sessionId: stripeSessionId,
      adminUserId: req.user.id,
    });

    if (!verification.ok) {
      if (verification.reason === 'STRIPE_NOT_CONFIGURED') {
        return res.status(409).json({
          error: 'Conflict',
          message: 'Checkout Stripe nao configurado no backend.',
          reason: verification.reason,
        });
      }

      if (verification.reason === 'ADMIN_MISMATCH') {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Sessao de checkout nao pertence ao ADMIN autenticado.',
          reason: verification.reason,
        });
      }

      if (verification.reason === 'SESSION_NOT_PAID') {
        return res.status(402).json({
          error: 'Payment Required',
          message: 'Sessao Stripe ainda nao foi concluida/paga.',
          reason: verification.reason,
          status: verification.status,
          paymentStatus: verification.paymentStatus,
        });
      }

      return res.status(400).json({
        error: 'Bad Request',
        message: 'Sessao Stripe invalida para confirmar cadeiras adicionais.',
        reason: verification.reason,
      });
    }

    const currentAdmin = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        photoPath: true,
        photoUpdatedAt: true,
        organizationAdminId: true,
        adminPlanId: true,
        adminSeatLimit: true,
        adminExtraSeatPrice: true,
        adminPlanStatus: true,
        adminPlanLinkedAt: true,
        adminActiveSeats: true,
        adminExtraSeatsContracted: true,
        adminPlan: {
          select: {
            id: true,
            code: true,
            name: true,
            monthlyPrice: true,
            isActive: true,
          },
        },
      },
    });

    if (!currentAdmin) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Usuario ADMIN nao encontrado.',
      });
    }

    if (!currentAdmin.adminPlanId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Nao e possivel contratar cadeiras extras sem plano vinculado.',
      });
    }

    const currentSeatLimit = Number.isInteger(currentAdmin.adminSeatLimit)
      ? currentAdmin.adminSeatLimit
      : 0;
    const nextSeatLimit = currentSeatLimit + verification.contractedExtraSeats;

    const occupiedSeats = await prisma.user.count({
      where: {
        organizationAdminId: req.user.id,
        role: { in: TEAM_MEMBER_ROLES },
        isActive: true,
      },
    });

    const seatSnapshot = buildPersistedAdminSeatSnapshot({
      planCode: currentAdmin.adminPlan?.code,
      seatLimit: nextSeatLimit,
      occupiedSeats,
    });

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        adminSeatLimit: nextSeatLimit,
        adminActiveSeats: seatSnapshot.activeSeats,
        adminExtraSeatsContracted: seatSnapshot.contractedExtraSeats,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        photoPath: true,
        photoUpdatedAt: true,
        organizationAdminId: true,
        adminSeatLimit: true,
        adminExtraSeatPrice: true,
        adminPlanStatus: true,
        adminPlanLinkedAt: true,
        adminActiveSeats: true,
        adminExtraSeatsContracted: true,
        adminPlan: {
          select: {
            id: true,
            code: true,
            name: true,
            monthlyPrice: true,
            isActive: true,
          },
        },
      },
    });

    return res.json({
      message: 'Cadeiras adicionais confirmadas e salvas no banco com sucesso.',
      billing: {
        sessionId: verification.sessionId,
        seatLimit: updatedUser.adminSeatLimit,
        activeSeats: updatedUser.adminActiveSeats,
        contractedExtraSeats: updatedUser.adminExtraSeatsContracted,
        newlyContractedSeats: verification.contractedExtraSeats,
      },
      user: withPhotoUrl(req, {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
        photoPath: updatedUser.photoPath,
        photoUpdatedAt: updatedUser.photoUpdatedAt,
        organizationAdminId: updatedUser.organizationAdminId,
        adminSeatLimit: updatedUser.adminSeatLimit,
        adminExtraSeatPrice: updatedUser.adminExtraSeatPrice,
        adminActiveSeats: updatedUser.adminActiveSeats,
        adminExtraSeatsContracted: updatedUser.adminExtraSeatsContracted,
        adminPlanStatus: updatedUser.adminPlanStatus,
        adminPlanLinkedAt: updatedUser.adminPlanLinkedAt,
        adminPlan: updatedUser.adminPlan,
      }),
    });
  } catch (error) {
    console.error('❌ Erro ao confirmar checkout de cadeiras adicionais:', error);

    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao confirmar checkout de cadeiras adicionais',
    });
  }
};

/**
 * POST /users/me/photo
 * Faz upload de foto de perfil do usuário autenticado
 */
const uploadMyPhoto = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Envie a foto no campo "photo".',
      });
    }

    const existingUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        photoPath: true,
      },
    });

    if (!existingUser) {
      removePhotoFileIfExists(req.file.path);
      return res.status(404).json({
        error: 'Not Found',
        message: 'Usuário não encontrado',
      });
    }

    const nextPhotoPath = normalizePhotoPath(path.join('uploads', 'user-photos', req.file.filename));

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        photoPath: nextPhotoPath,
        photoUpdatedAt: new Date(),
      },
      select: {
        id: true,
        photoPath: true,
        photoUpdatedAt: true,
      },
    });

    removePhotoFileIfExists(existingUser.photoPath);

    return res.json({
      message: 'Foto de perfil atualizada com sucesso.',
      photo: {
        photoUrl: buildUserPhotoUrl(req, updatedUser.photoPath),
        photoUpdatedAt: updatedUser.photoUpdatedAt,
      },
    });
  } catch (error) {
    console.error('❌ Erro ao fazer upload da foto de perfil:', error);
    removePhotoFileIfExists(req.file?.path);

    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao salvar foto de perfil',
    });
  }
};

/**
 * DELETE /users/me/photo
 * Remove foto de perfil do usuário autenticado
 */
const deleteMyPhoto = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        photoPath: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Usuário não encontrado',
      });
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        photoPath: null,
        photoUpdatedAt: null,
      },
    });

    removePhotoFileIfExists(user.photoPath);

    return res.json({
      message: 'Foto de perfil removida com sucesso.',
      photo: {
        photoUrl: null,
        photoUpdatedAt: null,
      },
    });
  } catch (error) {
    console.error('❌ Erro ao remover foto de perfil:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao remover foto de perfil',
    });
  }
};

/**
 * Deletar usuário (Admin only)
 */
const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Não permite deletar a si mesmo
    if (id === req.user.id) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Você não pode deletar sua própria conta',
      });
    }

    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Usuário não encontrado',
      });
    }

    if (
      req.user.role === 'ADMIN' &&
      user.id !== req.user.id &&
      user.organizationAdminId !== req.user.id
    ) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você só pode deletar usuários do seu próprio time',
      });
    }

    // Deleta do Supabase
    await supabaseAdmin.auth.admin.deleteUser(id);

    // Deleta do banco local
    await prisma.user.delete({
      where: { id },
    });

    if (TEAM_MEMBER_ROLES.includes(user.role) && user.organizationAdminId) {
      try {
        await syncAdminSeatSnapshot(user.organizationAdminId);
      } catch (syncError) {
        console.warn('⚠️ Falha ao sincronizar snapshot de cadeiras após remoção:', syncError.message);
      }
    }

    console.log(`✅ Usuário deletado: ${user.email}`);

    res.json({
      message: 'Usuário deletado com sucesso',
    });
  } catch (error) {
    console.error('❌ Erro ao deletar usuário:', error);

    if (error.code === 'P2003') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Não é possível deletar usuário com registros associados',
      });
    }

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao deletar usuário',
    });
  }
};

/**
 * GET /users/me/face
 * Retorna status do cadastro facial do usuário logado
 */
const getMyFaceStatus = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        facialEmbedding: true,
        facialEmbeddingUpdatedAt: true,
        facialThreshold: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Usuário não encontrado',
      });
    }

    res.json({
      face: {
        enrolled: Boolean(user.facialEmbedding),
        updatedAt: user.facialEmbeddingUpdatedAt,
        threshold: user.facialThreshold,
      },
    });
  } catch (error) {
    console.error('❌ Erro ao buscar status facial:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar status facial',
    });
  }
};

/**
 * POST /users/me/face/enroll
 * Cadastra/atualiza embedding facial do usuário logado
 */
const enrollMyFace = async (req, res) => {
  try {
    const { faceDescriptor, threshold, livenessData } = req.body;

    const liveness = validateLivenessEvidence(livenessData);

    if (!liveness.valid) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Prova de vida inválida para cadastro facial. Pisque e mova a cabeça durante a captura.',
        liveness,
      });
    }

    const normalizedEmbedding = normalizeEmbedding(faceDescriptor);

    if (!normalizedEmbedding) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'faceDescriptor inválido. Envie um vetor numérico válido.',
      });
    }

    let normalizedThreshold = DEFAULT_THRESHOLD;
    if (threshold !== undefined) {
      const parsedThreshold = Number(threshold);
      if (!Number.isFinite(parsedThreshold) || parsedThreshold <= 0 || parsedThreshold >= 2) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'threshold inválido. Use um número entre 0 e 2.',
        });
      }
      normalizedThreshold = parsedThreshold;
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        facialEmbedding: normalizedEmbedding,
        facialEmbeddingUpdatedAt: new Date(),
        facialThreshold: normalizedThreshold,
      },
      select: {
        id: true,
        facialEmbeddingUpdatedAt: true,
        facialThreshold: true,
      },
    });

    res.json({
      message: 'Reconhecimento facial cadastrado com sucesso',
      face: {
        enrolled: true,
        updatedAt: updatedUser.facialEmbeddingUpdatedAt,
        threshold: updatedUser.facialThreshold,
      },
    });
  } catch (error) {
    console.error('❌ Erro ao cadastrar facial:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao cadastrar reconhecimento facial',
    });
  }
};

/**
 * DELETE /users/me/face
 * Remove o cadastro facial do usuário logado
 */
const deleteMyFace = async (req, res) => {
  try {
    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        facialEmbedding: null,
        facialEmbeddingUpdatedAt: null,
      },
    });

    res.json({
      message: 'Cadastro facial removido com sucesso',
      face: {
        enrolled: false,
      },
    });
  } catch (error) {
    console.error('❌ Erro ao remover facial:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao remover reconhecimento facial',
    });
  }
};

module.exports = {
  createUser,
  updateUser,
  listUsers,
  listAdminSeatAssignments,
  listSuperAdminAccountsOverview,
  getUserById,
  deleteUser,
  getMyCompleteProfile,
  updateMyAccount,
  createMyTeamInviteLink,
  createMyAdditionalSeatsCheckout,
  chooseMyPlan,
  confirmAdditionalSeatsCheckout,
  uploadMyPhoto,
  deleteMyPhoto,
  getMyFaceStatus,
  enrollMyFace,
  deleteMyFace,
};
