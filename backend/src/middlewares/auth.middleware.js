const { supabase } = require('../config/supabase');
const prisma = require('../config/database');

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
      include: {
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
      },
    });

    // Se o usuário não existe no banco local, retorna erro
    if (!user) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Usuário não cadastrado no sistema. Contate o administrador.',
      });
    }

    // Calcula o plano atual do usuário baseado no admin dono do workspace
    let currentPlan = 'BASE';
    let currentPlanStatus = 'INACTIVE';

    if (user.role === 'SUPERADMIN') {
      currentPlan = 'PRO'; // Superadmin tem tudo
      currentPlanStatus = 'ACTIVE';
    } else if (user.role === 'ADMIN') {
      currentPlan = user.adminPlan?.code || 'BASE';
      currentPlanStatus = user.adminPlanStatus;
    } else if (user.organizationAdmin) {
      currentPlan = user.organizationAdmin.adminPlan?.code || 'BASE';
      currentPlanStatus = user.organizationAdmin.adminPlanStatus;
    }

    user.currentPlan = currentPlan;
    user.currentPlanStatus = currentPlanStatus;

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
