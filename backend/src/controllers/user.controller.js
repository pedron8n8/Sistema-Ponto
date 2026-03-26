const prisma = require('../config/database');
const fs = require('fs');
const path = require('path');
const { supabaseAdmin } = require('../config/supabase');
const { normalizeEmbedding, DEFAULT_THRESHOLD } = require('../utils/faceRecognition');
const { validateLivenessEvidence } = require('../utils/liveness');
const { buildUserPhotoUrl, normalizePhotoPath } = require('../utils/userPhoto');
const { createAdditionalSeatsCheckoutSession } = require('../utils/seatBilling');

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
const EXTRA_ADMIN_SEAT_MONTHLY_USD = 10;

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

const resolveAdminSeatConfig = ({ adminSeatLimit, adminExtraSeatPrice }) => {
  const nextSeatLimit = adminSeatLimit === undefined ? 10 : Number(adminSeatLimit);
  if (!Number.isInteger(nextSeatLimit) || nextSeatLimit < 1) {
    return {
      error: 'adminSeatLimit deve ser um número inteiro maior ou igual a 1',
    };
  }

  const nextExtraSeatPrice =
    adminExtraSeatPrice === undefined ? 0 : Number(adminExtraSeatPrice);

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

    if (!password || password.length < 6) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Senha deve ter pelo menos 6 caracteres',
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
          },
        }));

      const currentTeamSize = await prisma.user.count({
        where: {
          organizationAdminId: targetOrganizationAdminId,
          role: { in: TEAM_MEMBER_ROLES },
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
          organizationAdminId: targetOrganizationAdminId,
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

    let adminSeatConfigData = {};
    if (requestedRole === 'ADMIN') {
      const seatConfig = resolveAdminSeatConfig({ adminSeatLimit, adminExtraSeatPrice });
      adminSeatConfigData = {
        adminSeatLimit: seatConfig.adminSeatLimit,
        adminExtraSeatPrice: seatConfig.adminExtraSeatPrice,
      };
    }

    // Cria usuário no banco local
    const user = await prisma.user.create({
      data: {
        id: supabaseUser.user.id,
        email,
        name: name.trim(),
        role: requestedRole,
        supervisorId: supervisorId || null,
        organizationAdminId: targetOrganizationAdminId,
        ...adminSeatConfigData,
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
      },
    });

    console.log(`✅ Usuário criado com sucesso: ${user.email} (${user.role})`);

    res.status(201).json({
      message: 'Usuário criado com sucesso',
      user: withPhotoUrl(req, {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organizationAdminId: user.organizationAdminId,
        adminSeatLimit: user.adminSeatLimit,
        adminExtraSeatPrice: user.adminExtraSeatPrice,
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
    const { name, role, supervisorId, adminSeatLimit, adminExtraSeatPrice } = req.body;

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

    if (role === 'SUPERADMIN' && req.user.role !== 'SUPERADMIN') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Apenas SUPERADMIN pode atribuir papel SUPERADMIN',
      });
    }

    if (role === 'ADMIN' && req.user.role !== 'SUPERADMIN') {
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

    let adminSeatConfigData = {};
    if (existingUser.role === 'ADMIN' || role === 'ADMIN') {
      if (req.user.role !== 'SUPERADMIN') {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Apenas SUPERADMIN pode alterar configuração de cadeiras de ADMIN',
        });
      }

      if (adminSeatLimit !== undefined || adminExtraSeatPrice !== undefined) {
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
    }

    // Atualiza usuário
    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        ...(name && { name: name.trim() }),
        ...(role && { role }),
        ...(supervisorId !== undefined && { supervisorId }),
        ...adminSeatConfigData,
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
      },
    });

    // Atualiza metadados no Supabase (se role mudou)
    if (role && role !== existingUser.role) {
      await supabaseAdmin.auth.admin.updateUserById(id, {
        user_metadata: {
          name: updatedUser.name,
          role: updatedUser.role,
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
        adminSeatLimit: updatedUser.adminSeatLimit,
        adminExtraSeatPrice: updatedUser.adminExtraSeatPrice,
        supervisor: updatedUser.supervisor,
        createdAt: updatedUser.createdAt,
      }),
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
    const { role, search, page = 1, limit = 50 } = req.query;

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

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          photoPath: true,
          photoUpdatedAt: true,
          contractDailyMinutes: true,
          workdayStartTime: true,
          workdayEndTime: true,
          hourlyRate: true,
          timeZone: true,
          supervisor: {
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
            },
          },
          createdAt: true,
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

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
      include: {
        supervisor: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
        subordinates: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
        _count: {
          select: {
            timeEntries: true,
            reviewedLogs: true,
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
        organizationAdminId: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const membersByAdmin = members.reduce((acc, member) => {
      const ownerId = member.organizationAdminId;
      if (!ownerId) return acc;
      if (!acc[ownerId]) acc[ownerId] = [];
      acc[ownerId].push(member);
      return acc;
    }, {});

    const payload = admins.map((admin) => {
      const teamMembers = membersByAdmin[admin.id] || [];
      const seatLimit = admin.adminSeatLimit;
      const occupiedSeats = teamMembers.length;
      const totalSeats = Number.isInteger(seatLimit)
        ? Math.max(seatLimit, occupiedSeats)
        : occupiedSeats;

      const seats = Array.from({ length: totalSeats }, (_, index) => {
        const occupant = teamMembers[index] || null;
        return {
          seatNumber: index + 1,
          occupied: Boolean(occupant),
          occupant,
        };
      });

      const overageSeats = Number.isInteger(seatLimit)
        ? Math.max(0, occupiedSeats - seatLimit)
        : 0;

      return {
        admin: {
          id: admin.id,
          name: admin.name,
          email: admin.email,
        },
        billing: {
          seatLimit,
          occupiedSeats,
          availableSeats: Number.isInteger(seatLimit) ? Math.max(0, seatLimit - occupiedSeats) : null,
          overageSeats,
          extraSeatPriceUsd: Number(admin.adminExtraSeatPrice ?? 10),
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
 * GET /users/me/profile-complete
 * Retorna perfil completo do usuário autenticado
 */
const getMyCompleteProfile = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
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
    const { name, email, password } = req.body;

    if (name === undefined && email === undefined && password === undefined) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Informe ao menos um campo para atualizar: name, email ou password.',
      });
    }

    const normalizedName = name !== undefined ? String(name).trim() : undefined;
    const normalizedEmail = email !== undefined ? String(email).trim().toLowerCase() : undefined;
    const normalizedPassword = password !== undefined ? String(password) : undefined;

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

    if (normalizedPassword !== undefined && normalizedPassword.length > 0 && normalizedPassword.length < 6) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Senha deve ter pelo menos 6 caracteres',
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

    const supabasePayload = {
      ...(normalizedEmail !== undefined ? { email: normalizedEmail } : {}),
      ...(normalizedPassword !== undefined && normalizedPassword.length > 0
        ? { password: normalizedPassword }
        : {}),
      user_metadata: {
        name: nextName,
        role: req.user.role,
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


    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Usuário não encontrado',
      });
    }

    // Deleta do Supabase
    await supabaseAdmin.auth.admin.deleteUser(id);

    // Deleta do banco local
    await prisma.user.delete({
      where: { id },
    });

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
  getUserById,
  deleteUser,
  getMyCompleteProfile,
  updateMyAccount,
  uploadMyPhoto,
  deleteMyPhoto,
  getMyFaceStatus,
  enrollMyFace,
  deleteMyFace,
};
