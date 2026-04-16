const PublicApiError = require('../errors/PublicApiError');
const {
  assertAdminRepositoryPort,
  assertPublicApiTokenServicePort,
} = require('../ports/contracts');

const resolveAdminPlan = (admin) => {
  if (!admin) {
    return {
      currentPlan: 'STARTER',
      currentPlanStatus: 'INACTIVE',
    };
  }

  if (admin.role === 'SUPERADMIN') {
    return {
      currentPlan: 'PRO',
      currentPlanStatus: 'ACTIVE',
    };
  }

  return {
    currentPlan: admin.adminPlan?.code || 'STARTER',
    currentPlanStatus: admin.adminPlanStatus || 'INACTIVE',
  };
};

const extractBearerToken = (authorizationHeader) => {
  const header = String(authorizationHeader || '').trim();

  if (!header || !header.startsWith('Bearer ')) {
    throw new PublicApiError({
      status: 401,
      error: 'Unauthorized',
      message: 'Token da API pública não informado.',
    });
  }

  const token = header.substring(7).trim();
  if (!token) {
    throw new PublicApiError({
      status: 401,
      error: 'Unauthorized',
      message: 'Token da API pública não informado.',
    });
  }

  return token;
};

const createAuthenticatePublicApiTokenUseCase = ({
  adminRepository,
  tokenService,
}) => {
  assertAdminRepositoryPort(adminRepository);
  assertPublicApiTokenServicePort(tokenService);

  const execute = async ({ authorizationHeader }) => {
    const token = extractBearerToken(authorizationHeader);

    let tokenPayload;
    try {
      tokenPayload = tokenService.verifyToken(token);
    } catch (error) {
      throw new PublicApiError({
        status: 401,
        error: 'Unauthorized',
        message: error.message || 'Token inválido.',
      });
    }

    const admin = await adminRepository.findByIdForPublicApiAuth(tokenPayload.adminId);

    if (!admin || !['ADMIN', 'SUPERADMIN'].includes(admin.role)) {
      throw new PublicApiError({
        status: 401,
        error: 'Unauthorized',
        message: 'Conta administradora inválida para a API pública.',
      });
    }

    const { currentPlan, currentPlanStatus } = resolveAdminPlan(admin);
    const planIsActive =
      admin.role === 'SUPERADMIN' || (currentPlan === 'PRO' && currentPlanStatus === 'ACTIVE');

    if (!planIsActive) {
      throw new PublicApiError({
        status: 403,
        error: 'Forbidden',
        message: 'API pública disponível somente para administradores PRO ativos.',
        code: 'UPGRADE_REQUIRED',
      });
    }

    return {
      admin: {
        ...admin,
        currentPlan,
        currentPlanStatus,
      },
      token,
      tokenPayload,
      scopes: Array.isArray(tokenPayload.scopes) ? tokenPayload.scopes : [],
    };
  };

  return {
    execute,
  };
};

module.exports = {
  createAuthenticatePublicApiTokenUseCase,
};
