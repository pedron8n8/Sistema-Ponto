// Testes para roleCheck middleware

const roleCheck = require('../../src/middlewares/roleCheck.middleware');

describe('RoleCheck Middleware', () => {
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    mockReq = {
      user: null,
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  describe('Role validation', () => {
    it('should return 401 if no user is attached to request', () => {
      const middleware = roleCheck(['ADMIN']);

      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Usuário não autenticado',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 403 if user role is not in allowed roles', () => {
      mockReq.user = { id: '123', role: 'MEMBER' };
      const middleware = roleCheck(['ADMIN']);

      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Forbidden',
          message: expect.stringContaining('Acesso negado'),
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should call next() if user role is ADMIN and ADMIN is allowed', () => {
      mockReq.user = { id: '123', role: 'ADMIN' };
      const middleware = roleCheck(['ADMIN']);

      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should call next() if user role is SUPERVISOR and SUPERVISOR is allowed', () => {
      mockReq.user = { id: '123', role: 'SUPERVISOR' };
      const middleware = roleCheck(['SUPERVISOR', 'ADMIN']);

      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should call next() if user role is MEMBER and MEMBER is allowed', () => {
      mockReq.user = { id: '123', role: 'MEMBER' };
      const middleware = roleCheck(['MEMBER', 'SUPERVISOR', 'ADMIN']);

      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should work with single role in array', () => {
      mockReq.user = { id: '123', role: 'SUPERVISOR' };
      const middleware = roleCheck(['SUPERVISOR']);

      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should be case sensitive for roles', () => {
      mockReq.user = { id: '123', role: 'admin' };
      const middleware = roleCheck(['ADMIN']);

      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
    });
  });

  describe('Factory function', () => {
    it('should return a middleware function', () => {
      const middleware = roleCheck(['ADMIN']);
      expect(typeof middleware).toBe('function');
    });

    it('should accept empty roles array (deny all)', () => {
      mockReq.user = { id: '123', role: 'ADMIN' };
      const middleware = roleCheck([]);

      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
    });
  });
});
