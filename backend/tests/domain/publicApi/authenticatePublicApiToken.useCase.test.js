const {
  createAuthenticatePublicApiTokenUseCase,
} = require('../../../src/domain/publicApi/useCases/authenticatePublicApiToken.useCase');

describe('AuthenticatePublicApiTokenUseCase', () => {
  const makeDeps = (overrides = {}) => {
    const adminRepository = {
      findByIdForIssueToken: jest.fn(),
      findByIdForPublicApiAuth: jest.fn().mockResolvedValue({
        id: 'admin-1',
        role: 'ADMIN',
        email: 'admin@empresa.com',
        name: 'Admin',
        adminPlanStatus: 'ACTIVE',
        adminPlan: {
          code: 'PRO',
          name: 'Pro',
        },
      }),
    };

    const tokenService = {
      issueToken: jest.fn(),
      verifyToken: jest.fn().mockReturnValue({
        adminId: 'admin-1',
        scopes: ['payroll:read'],
      }),
      maskToken: jest.fn(),
    };

    return {
      adminRepository,
      tokenService,
      ...overrides,
    };
  };

  it('autentica token valido de ADMIN PRO ativo', async () => {
    const deps = makeDeps();
    const useCase = createAuthenticatePublicApiTokenUseCase(deps);

    const result = await useCase.execute({
      authorizationHeader: 'Bearer token-abc',
    });

    expect(deps.tokenService.verifyToken).toHaveBeenCalledWith('token-abc');
    expect(result.admin.currentPlan).toBe('PRO');
    expect(result.scopes).toEqual(['payroll:read']);
  });

  it('retorna 401 sem authorization header', async () => {
    const deps = makeDeps();
    const useCase = createAuthenticatePublicApiTokenUseCase(deps);

    await expect(useCase.execute({ authorizationHeader: '' })).rejects.toMatchObject({
      status: 401,
      error: 'Unauthorized',
    });
  });

  it('retorna 401 para token invalido', async () => {
    const deps = makeDeps({
      tokenService: {
        issueToken: jest.fn(),
        verifyToken: jest.fn(() => {
          throw new Error('Assinatura inválida');
        }),
        maskToken: jest.fn(),
      },
    });

    const useCase = createAuthenticatePublicApiTokenUseCase(deps);

    await expect(
      useCase.execute({ authorizationHeader: 'Bearer token-abc' })
    ).rejects.toMatchObject({
      status: 401,
      error: 'Unauthorized',
    });
  });

  it('retorna 401 quando conta admin nao encontrada', async () => {
    const deps = makeDeps({
      adminRepository: {
        findByIdForIssueToken: jest.fn(),
        findByIdForPublicApiAuth: jest.fn().mockResolvedValue(null),
      },
    });

    const useCase = createAuthenticatePublicApiTokenUseCase({
      adminRepository: deps.adminRepository,
      tokenService: makeDeps().tokenService,
    });

    await expect(
      useCase.execute({ authorizationHeader: 'Bearer token-abc' })
    ).rejects.toMatchObject({
      status: 401,
      error: 'Unauthorized',
    });
  });

  it('retorna 403 quando ADMIN nao esta em PRO ativo', async () => {
    const deps = makeDeps({
      adminRepository: {
        findByIdForIssueToken: jest.fn(),
        findByIdForPublicApiAuth: jest.fn().mockResolvedValue({
          id: 'admin-1',
          role: 'ADMIN',
          email: 'admin@empresa.com',
          name: 'Admin',
          adminPlanStatus: 'INACTIVE',
          adminPlan: {
            code: 'PRO',
            name: 'Pro',
          },
        }),
      },
    });

    const useCase = createAuthenticatePublicApiTokenUseCase({
      adminRepository: deps.adminRepository,
      tokenService: makeDeps().tokenService,
    });

    await expect(
      useCase.execute({ authorizationHeader: 'Bearer token-abc' })
    ).rejects.toMatchObject({
      status: 403,
      error: 'Forbidden',
      code: 'UPGRADE_REQUIRED',
    });
  });
});
