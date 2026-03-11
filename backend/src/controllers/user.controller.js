const prisma = require('../config/database');
const { supabaseAdmin } = require('../config/supabase');

/**
 * Controller para gerenciamento de usuários
 */

/**
 * Criar novo usuário (Admin only)
 * Cria usuário no Supabase e sincroniza com banco local
 */
const createUser = async (req, res) => {
  try {
    const { email, name, role, password, supervisorId } = req.body;

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

    const validRoles = ['ADMIN', 'SUPERVISOR', 'MEMBER'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Role inválida. Valores aceitos: ${validRoles.join(', ')}`,
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

      if (!['ADMIN', 'SUPERVISOR'].includes(supervisor.role)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Apenas Admin ou Supervisor podem ser atribuídos como supervisores',
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

    // Cria usuário no Supabase
    const { data: supabaseUser, error: supabaseError } = await supabaseAdmin.auth.admin.createUser(
      {
        email,
        password,
        email_confirm: true,
        user_metadata: {
          name,
          role: role || 'MEMBER',
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

    // Cria usuário no banco local
    const user = await prisma.user.create({
      data: {
        id: supabaseUser.user.id,
        email,
        name: name.trim(),
        role: role || 'MEMBER',
        supervisorId: supervisorId || null,
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
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        supervisor: user.supervisor,
        createdAt: user.createdAt,
      },
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
    const { name, role, supervisorId } = req.body;

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
    const validRoles = ['ADMIN', 'SUPERVISOR', 'MEMBER'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Role inválida. Valores aceitos: ${validRoles.join(', ')}`,
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

      if (!['ADMIN', 'SUPERVISOR'].includes(supervisor.role)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Apenas Admin ou Supervisor podem ser atribuídos como supervisores',
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

    // Atualiza usuário
    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        ...(name && { name: name.trim() }),
        ...(role && { role }),
        ...(supervisorId !== undefined && { supervisorId }),
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
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
        supervisor: updatedUser.supervisor,
        createdAt: updatedUser.createdAt,
      },
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
 * Listar todos os usuários (Admin/Supervisor)
 */
const listUsers = async (req, res) => {
  try {
    const { role, search, page = 1, limit = 50 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};

    // Filtro por role
    if (role && ['ADMIN', 'SUPERVISOR', 'MEMBER'].includes(role)) {
      where.role = role;
    }

    // Filtro por busca (nome ou email)
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Se for supervisor, só mostra seus subordinados
    if (req.user.role === 'SUPERVISOR') {
      where.supervisorId = req.user.id;
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
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

    res.json({
      users,
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

    res.json({ user });
  } catch (error) {
    console.error('❌ Erro ao buscar usuário:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar usuário',
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

module.exports = {
  createUser,
  updateUser,
  listUsers,
  getUserById,
  deleteUser,
};
