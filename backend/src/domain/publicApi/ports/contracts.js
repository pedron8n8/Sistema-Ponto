const ensureFunction = (target, fieldName, contractName) => {
  if (!target || typeof target[fieldName] !== 'function') {
    throw new Error(`Contrato inválido (${contractName}): método obrigatório \"${fieldName}\" ausente.`);
  }
};

/**
 * Contrato esperado para o adapter de administração.
 * @param {object} adminRepository
 */
const assertAdminRepositoryPort = (adminRepository) => {
  ensureFunction(adminRepository, 'findByIdForIssueToken', 'AdminRepositoryPort');
  ensureFunction(adminRepository, 'findByIdForPublicApiAuth', 'AdminRepositoryPort');
};

/**
 * Contrato esperado para o serviço de token da API pública.
 * @param {object} tokenService
 */
const assertPublicApiTokenServicePort = (tokenService) => {
  ensureFunction(tokenService, 'issueToken', 'PublicApiTokenServicePort');
  ensureFunction(tokenService, 'verifyToken', 'PublicApiTokenServicePort');
  ensureFunction(tokenService, 'maskToken', 'PublicApiTokenServicePort');
};

module.exports = {
  assertAdminRepositoryPort,
  assertPublicApiTokenServicePort,
};
