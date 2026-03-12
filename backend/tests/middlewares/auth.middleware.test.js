// Testes para authMiddleware

const mockPrisma = require('../mocks/prisma.mock');
const { mockSupabaseAdmin } = require('../mocks/supabase.mock');

// Mock dos módulos antes de importar o middleware
jest.mock('../../src/config/database', () => mockPrisma);
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: mockSupabaseAdmin }));

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
      mockSupabaseAdmin.auth.getUser.mockResolvedValue({
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

    it('should return 403 if user is not found in local database', async () => {
      mockReq.headers.authorization = 'Bearer valid_token';
      mockSupabaseAdmin.auth.getUser.mockResolvedValue({
        data: {
          user: {
            id: 'user-123',
            email: 'test@test.com',
          },
        },
        error: null,
      });
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await authMiddleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Forbidden',
          message: 'Usuário não cadastrado no sistema',
        })
      );
    });

    it('should call next() and set req.user for valid token', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@test.com',
        name: 'Test User',
        role: 'MEMBER',
      };

      mockReq.headers.authorization = 'Bearer valid_token';
      mockSupabaseAdmin.auth.getUser.mockResolvedValue({
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
      expect(mockReq.user).toEqual(mockUser);
    });
  });

  describe('Error handling', () => {
    it('should return 500 on unexpected error', async () => {
      mockReq.headers.authorization = 'Bearer valid_token';
      mockSupabaseAdmin.auth.getUser.mockRejectedValue(new Error('Database error'));

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
