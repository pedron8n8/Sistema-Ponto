// Testes para authMiddleware

const mockPrisma = require('../mocks/prisma.mock');
const { mockSupabase } = require('../mocks/supabase.mock');

// Mock dos módulos antes de importar o middleware
jest.mock('../../src/config/database', () => mockPrisma);
jest.mock('../../src/config/supabase', () => ({ supabase: mockSupabase }));
jest.mock('../../src/utils/teamInviteToken', () => ({
  verifyTeamInviteToken: jest.fn(),
}));

const { verifyTeamInviteToken } = require('../../src/utils/teamInviteToken');

const authMiddleware = require('../../src/middlewares/auth.middleware');

describe('Auth Middleware', () => {
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    mockReq = {
      headers: {},
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  describe('Token validation', () => {
    it('should return 401 if no authorization header is provided', async () => {
      await authMiddleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Token de autenticação não fornecido',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 if authorization header does not start with Bearer', async () => {
      mockReq.headers.authorization = 'Basic token123';

      await authMiddleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Token de autenticação não fornecido',
      });
    });

    it('should return 401 if token is invalid', async () => {
      mockReq.headers.authorization = 'Bearer invalid_token';
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Invalid token' },
      });

      await authMiddleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
        })
      );
    });

    it('should provision local user when missing and continue request', async () => {
      mockReq.headers.authorization = 'Bearer valid_token';
      const mockSupabaseUser = {
        id: 'user-123',
        email: 'test@test.com',
        user_metadata: { name: 'Test User' },
      };

      mockSupabase.auth.getUser.mockResolvedValue({
        data: {
          user: mockSupabaseUser,
        },
        error: null,
      });

      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'user-123',
          email: 'test@test.com',
        })
        .mockResolvedValueOnce({
          id: 'user-123',
          email: 'test@test.com',
          name: 'Test User',
          role: 'ADMIN',
          adminPlan: null,
          adminPlanStatus: 'INACTIVE',
          organizationAdmin: null,
        });
      mockPrisma.user.upsert.mockResolvedValue({ id: 'user-123' });

      await authMiddleware(mockReq, mockRes, mockNext);

      expect(mockPrisma.user.upsert).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toEqual(
        expect.objectContaining({
          id: 'user-123',
          role: 'ADMIN',
          currentPlan: 'STARTER',
          currentPlanStatus: 'INACTIVE',
        })
      );
    });

    it('should call next() and set req.user for valid token', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@test.com',
        name: 'Test User',
        role: 'MEMBER',
        adminPlan: null,
        adminPlanStatus: 'INACTIVE',
        organizationAdmin: null,
      };

      mockReq.headers.authorization = 'Bearer valid_token';
      mockSupabase.auth.getUser.mockResolvedValue({
        data: {
          user: {
            id: 'user-123',
            email: 'test@test.com',
          },
        },
        error: null,
      });
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await authMiddleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toEqual(
        expect.objectContaining({
          ...mockUser,
          currentPlan: 'STARTER',
          currentPlanStatus: 'INACTIVE',
        })
      );
    });

    it('should provision invited team member when invite token is valid', async () => {
      mockReq.headers.authorization = 'Bearer valid_token';
      const mockSupabaseUser = {
        id: 'invitee-123',
        email: 'invitee@test.com',
        user_metadata: {
          name: 'Invitee User',
          teamInviteToken: 'invite-token-123',
        },
      };

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: mockSupabaseUser },
        error: null,
      });

      verifyTeamInviteToken.mockReturnValue({
        adminId: 'admin-owner-123',
        role: 'MEMBER',
      });

      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'admin-owner-123', role: 'ADMIN', adminSeatLimit: 10 })
        .mockResolvedValueOnce({
          id: 'invitee-123',
          email: 'invitee@test.com',
          name: 'Invitee User',
          role: 'MEMBER',
          adminPlan: null,
          adminPlanStatus: 'INACTIVE',
          organizationAdmin: {
            adminPlan: { code: 'STARTER' },
            adminPlanStatus: 'ACTIVE',
          },
        });
      mockPrisma.user.count.mockResolvedValue(0);

      mockPrisma.user.upsert.mockResolvedValue({ id: 'invitee-123' });

      await authMiddleware(mockReq, mockRes, mockNext);

      expect(verifyTeamInviteToken).toHaveBeenCalledWith('invite-token-123');
      expect(mockPrisma.user.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            role: 'MEMBER',
            organizationAdminId: 'admin-owner-123',
          }),
        })
      );
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toEqual(
        expect.objectContaining({
          id: 'invitee-123',
          role: 'MEMBER',
          currentPlan: 'STARTER',
          currentPlanStatus: 'ACTIVE',
        })
      );
    });

    it('should return 403 when invite token is invalid', async () => {
      mockReq.headers.authorization = 'Bearer valid_token';
      const mockSupabaseUser = {
        id: 'invitee-456',
        email: 'invitee2@test.com',
        user_metadata: {
          teamInviteToken: 'bad-token',
        },
      };

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: mockSupabaseUser },
        error: null,
      });

      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      verifyTeamInviteToken.mockImplementation(() => {
        throw new Error('Token de convite expirado.');
      });

      await authMiddleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Forbidden',
          message: 'Token de convite expirado.',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 403 when invited admin team is full', async () => {
      mockReq.headers.authorization = 'Bearer valid_token';
      const mockSupabaseUser = {
        id: 'invitee-789',
        email: 'invitee3@test.com',
        user_metadata: {
          teamInviteToken: 'invite-token-full-team',
        },
      };

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: mockSupabaseUser },
        error: null,
      });

      verifyTeamInviteToken.mockReturnValue({
        adminId: 'admin-owner-123',
        role: 'MEMBER',
      });

      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'admin-owner-123', role: 'ADMIN', adminSeatLimit: 1 });
      mockPrisma.user.count.mockResolvedValue(1);

      await authMiddleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Forbidden',
          message: expect.stringContaining('nao ha assentos disponiveis'),
        })
      );
      expect(mockPrisma.user.upsert).not.toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should return 500 on unexpected error', async () => {
      mockReq.headers.authorization = 'Bearer valid_token';
      mockSupabase.auth.getUser.mockRejectedValue(new Error('Database error'));

      await authMiddleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Internal Server Error',
        })
      );
    });
  });
});
