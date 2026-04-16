const PublicApiError = require('../errors/PublicApiError');
const {
  assertAdminRepositoryPort,
  assertPublicApiTokenServicePort,
} = require('../ports/contracts');

const createIssuePublicApiTokenUseCase = ({
  adminRepository,
  tokenService,
  getFeatureConfig,
}) => {
  assertAdminRepositoryPort(adminRepository);
  assertPublicApiTokenServicePort(tokenService);

  if (typeof getFeatureConfig !== 'function') {
    throw new Error('Contrato inválido (IssuePublicApiTokenUseCase): getFeatureConfig deve ser função.');
  }

  const execute = async ({ requesterId, expiresInHours, scopes }) => {
    const config = getFeatureConfig();

    if (!config?.publicApi?.enabled) {
      throw new PublicApiError({
        status: 409,
        error: 'Conflict',
        message: 'A API pública está desativada nas configurações PRO.',
      });
    }

    const ownerAdmin = await adminRepository.findByIdForIssueToken(requesterId);

    if (!ownerAdmin || ownerAdmin.role !== 'ADMIN') {
      throw new PublicApiError({
        status: 403,
        error: 'Forbidden',
        message: 'Somente administradores podem emitir token da API pública.',
      });
    }

    if (ownerAdmin.adminPlanStatus !== 'ACTIVE' || ownerAdmin.adminPlan?.code !== 'PRO') {
      throw new PublicApiError({
        status: 403,
        error: 'Forbidden',
        message: 'Token da API pública requer ADMIN com plano PRO ativo.',
      });
    }

    const normalizedScopes = Array.isArray(scopes) && scopes.length > 0 ? scopes : ['payroll:read'];

    const issued = tokenService.issueToken({
      adminId: requesterId,
      issuedById: requesterId,
      scopes: normalizedScopes,
      expiresInHours,
    });

    return {
      issued,
      tokenPreview: tokenService.maskToken(issued.token),
      normalizedScopes,
    };
  };

  return {
    execute,
  };
};

module.exports = {
  createIssuePublicApiTokenUseCase,
};
