const {
  createIssuePublicApiTokenUseCase,
} = require('../../../src/domain/publicApi/useCases/issuePublicApiToken.useCase');
const PublicApiError = require('../../../src/domain/publicApi/errors/PublicApiError');

describe('IssuePublicApiTokenUseCase', () => {
  const makeDeps = (overrides = {}) => {
    const adminRepository = {
      findByIdForIssueToken: jest.fn().mockResolvedValue({
        id: 'admin-1',
        role: 'ADMIN',
        adminPlanStatus: 'ACTIVE',
        adminPlan: { code: 'PRO' },
      }),
      findByIdForPublicApiAuth: jest.fn(),
    };

    const tokenService = {
      issueToken: jest.fn().mockReturnValue({
        token: 'token-abc',
        expiresAt: '2026-04-14T12:00:00.000Z',
        ttlHours: 24,
        payload: { scopes: ['payroll:read'] },
      }),
      verifyToken: jest.fn(),
      maskToken: jest.fn().mockReturnValue('token...c'),
    };

    const getFeatureConfig = jest.fn().mockReturnValue({
      publicApi: {
        enabled: true,
      },
    });

    return {
      adminRepository,
      tokenService,
      getFeatureConfig,
      ...overrides,
    };
  };

  it('emite token com sucesso para ADMIN PRO ativo', async () => {
    const deps = makeDeps();
    const useCase = createIssuePublicApiTokenUseCase(deps);

    const result = await useCase.execute({
      requesterId: 'admin-1',
      expiresInHours: 12,
      scopes: ['payroll:read'],
    });

    expect(deps.adminRepository.findByIdForIssueToken).toHaveBeenCalledWith('admin-1');
    expect(deps.tokenService.issueToken).toHaveBeenCalledWith({
      adminId: 'admin-1',
      issuedById: 'admin-1',
      scopes: ['payroll:read'],
      expiresInHours: 12,
    });
    expect(result.tokenPreview).toBe('token...c');
  });

  it('falha com 409 quando API publica esta desativada', async () => {
    const deps = makeDeps({
      getFeatureConfig: jest.fn().mockReturnValue({
        publicApi: { enabled: false },
      }),
    });
    const useCase = createIssuePublicApiTokenUseCase(deps);

    await expect(
      useCase.execute({ requesterId: 'admin-1' })
    ).rejects.toMatchObject({
      status: 409,
      error: 'Conflict',
    });
  });

  it('falha com 403 quando usuario nao e ADMIN', async () => {
    const deps = makeDeps();
    deps.adminRepository.findByIdForIssueToken.mockResolvedValue({
      id: 'super-1',
      role: 'SUPERADMIN',
      adminPlanStatus: 'ACTIVE',
      adminPlan: { code: 'PRO' },
    });

    const useCase = createIssuePublicApiTokenUseCase(deps);

    await expect(
      useCase.execute({ requesterId: 'super-1' })
    ).rejects.toMatchObject({
      status: 403,
      error: 'Forbidden',
    });
  });

  it('falha com 403 quando plano nao e PRO ativo', async () => {
    const deps = makeDeps();
    deps.adminRepository.findByIdForIssueToken.mockResolvedValue({
      id: 'admin-1',
      role: 'ADMIN',
      adminPlanStatus: 'INACTIVE',
      adminPlan: { code: 'PRO' },
    });

    const useCase = createIssuePublicApiTokenUseCase(deps);

    await expect(
      useCase.execute({ requesterId: 'admin-1' })
    ).rejects.toMatchObject({
      status: 403,
      error: 'Forbidden',
    });
  });

  it('erro de dominio usa PublicApiError', () => {
    const error = new PublicApiError({ status: 403, error: 'Forbidden', message: 'x' });
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(403);
  });
});
