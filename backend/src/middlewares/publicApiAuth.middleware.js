const { prisma } = require('../config/database');
const { createPrismaAdminRepository } = require('../adapters/adminRepository.prisma');
const { createPublicApiTokenService } = require('../adapters/publicApiToken.service');
const {
  createAuthenticatePublicApiTokenUseCase,
} = require('../domain/publicApi/useCases/authenticatePublicApiToken.useCase');
const PublicApiError = require('../domain/publicApi/errors/PublicApiError');

const createDefaultDependencies = () => {
  const adminRepository = createPrismaAdminRepository(prisma);
  const tokenService = createPublicApiTokenService();

  return {
    authenticatePublicApiTokenUseCase: createAuthenticatePublicApiTokenUseCase({
      adminRepository,
      tokenService,
    }),
  };
};

const defaultDependencies = createDefaultDependencies();

const createPublicApiAuthMiddleware = ({
  authenticatePublicApiTokenUseCase = defaultDependencies.authenticatePublicApiTokenUseCase,
} = {}) => {
  return async (req, res, next) => {
    try {
      const result = await authenticatePublicApiTokenUseCase.execute({
        authorizationHeader: req.headers.authorization,
      });

      req.publicApiAdmin = result.admin;
      req.publicApiAuth = {
        tokenPayload: result.tokenPayload,
        token: result.token,
        scopes: result.scopes,
      };

      next();
    } catch (error) {
      if (error instanceof PublicApiError) {
        return res.status(error.status).json({
          error: error.error,
          message: error.message,
          ...(error.code && { code: error.code }),
        });
      }

      console.error('❌ Erro na autenticação da API pública:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Erro ao validar token da API pública.',
      });
    }
  };
};

const publicApiAuthMiddleware = createPublicApiAuthMiddleware();

module.exports = publicApiAuthMiddleware;
module.exports.createPublicApiAuthMiddleware = createPublicApiAuthMiddleware;
