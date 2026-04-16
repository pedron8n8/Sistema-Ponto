const prisma = require('../config/database');
const {
  getProFeatureConfig,
  updateProLivenessConfig,
  updateProPublicApiConfig,
} = require('../utils/proFeatureConfig');
const { createPrismaAdminRepository } = require('../adapters/adminRepository.prisma');
const { createPublicApiTokenService } = require('../adapters/publicApiToken.service');
const {
  createIssuePublicApiTokenUseCase,
} = require('../domain/publicApi/useCases/issuePublicApiToken.useCase');
const PublicApiError = require('../domain/publicApi/errors/PublicApiError');

const createDefaultDependencies = () => {
  const adminRepository = createPrismaAdminRepository(prisma);
  const tokenService = createPublicApiTokenService();

  return {
    issuePublicApiTokenUseCase: createIssuePublicApiTokenUseCase({
      adminRepository,
      tokenService,
      getFeatureConfig: getProFeatureConfig,
    }),
  };
};

const defaultDependencies = createDefaultDependencies();

const createProController = ({
  getFeatureConfig = getProFeatureConfig,
  updateLivenessConfig = updateProLivenessConfig,
  updatePublicApiConfig = updateProPublicApiConfig,
  issuePublicApiTokenUseCase = defaultDependencies.issuePublicApiTokenUseCase,
} = {}) => {
  const getProFeatureSettings = async (req, res) => {
    try {
      const config = getFeatureConfig();

      res.json({
        proFeatures: {
          liveness: config.liveness,
          publicApi: {
            enabled: config.publicApi.enabled,
            defaultTokenTtlHours: config.publicApi.defaultTokenTtlHours,
            maxTokenTtlHours: config.publicApi.maxTokenTtlHours,
          },
          recommendations: {
            publicApiScope: ['payroll:read'],
            endpoints: [
              '/api/v1/public/payroll/time-entries',
              '/api/v1/public/payroll/summary',
            ],
          },
        },
        requestedBy: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
        },
      });
    } catch (error) {
      console.error('❌ Erro ao buscar configurações PRO:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Erro ao buscar configurações do plano PRO.',
      });
    }
  };

  const updateProLivenessSettings = async (req, res) => {
    try {
      const { enabled, maxAgeMs, minFrames, minHeadMovementDelta } = req.body || {};

      const next = updateLivenessConfig({
        enabled,
        maxAgeMs,
        minFrames,
        minHeadMovementDelta,
      });

      res.json({
        message: 'Configuração de liveness atualizada com sucesso.',
        liveness: next.liveness,
      });
    } catch (error) {
      console.error('❌ Erro ao atualizar liveness PRO:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Erro ao atualizar configuração de liveness.',
      });
    }
  };

  const updateProPublicApiSettings = async (req, res) => {
    try {
      const { enabled, defaultTokenTtlHours, maxTokenTtlHours } = req.body || {};

      const next = updatePublicApiConfig({
        enabled,
        defaultTokenTtlHours,
        maxTokenTtlHours,
      });

      res.json({
        message: 'Configuração da API pública atualizada com sucesso.',
        publicApi: next.publicApi,
      });
    } catch (error) {
      console.error('❌ Erro ao atualizar API pública PRO:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Erro ao atualizar configuração da API pública.',
      });
    }
  };

  const issueProPublicApiToken = async (req, res) => {
    try {
      const requester = req.user;
      const { expiresInHours, scopes } = req.body || {};

      const result = await issuePublicApiTokenUseCase.execute({
        requesterId: requester.id,
        expiresInHours,
        scopes,
      });

      res.status(201).json({
        message: 'Token da API pública emitido com sucesso.',
        token: result.issued.token,
        tokenPreview: result.tokenPreview,
        expiresAt: result.issued.expiresAt,
        ttlHours: result.issued.ttlHours,
        scopes: result.issued.payload.scopes,
        integration: {
          basePath: '/api/v1/public/payroll',
          endpoints: {
            timeEntries: '/api/v1/public/payroll/time-entries',
            summary: '/api/v1/public/payroll/summary',
          },
        },
      });
    } catch (error) {
      if (error instanceof PublicApiError) {
        return res.status(error.status).json({
          error: error.error,
          message: error.message,
          ...(error.code && { code: error.code }),
        });
      }

      console.error('❌ Erro ao emitir token da API pública PRO:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: error.message || 'Erro ao emitir token da API pública.',
      });
    }
  };

  return {
    getProFeatureSettings,
    updateProLivenessSettings,
    updateProPublicApiSettings,
    issueProPublicApiToken,
  };
};

const proController = createProController();

module.exports = {
  ...proController,
  createProController,
};
