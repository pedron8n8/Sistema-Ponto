// Testes para user.controller

const mockPrisma = require('../mocks/prisma.mock');
const { mockSupabaseAdmin } = require('../mocks/supabase.mock');

// Mock dos módulos
jest.mock('../../src/config/database', () => mockPrisma);
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: mockSupabaseAdmin }));

const {
  createUser,
  updateUser,
  listUsers,
  getUserById,
  deleteUser,
} = require('../../src/controllers/user.controller');

describe('User Controller', () => {
  let mockReq;
  let mockRes;

  beforeEach(() => {
    mockReq = {
      user: {
        id: 'admin-123',
        email: 'admin@test.com',
        role: 'ADMIN',
      },
      body: {},
      query: {},
      params: {},
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    jest.clearAllMocks();
  });

  describe('createUser', () => {
    it('should return 400 if email is invalid', async () => {
      mockReq.body = {
        email: 'invalid-email',
        name: 'Test User',
        password: 'password123',
      };

      await createUser(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Bad Request',
          message: expect.stringContaining('Email'),
        })
      );
    });

    it('should return 400 if name is too short', async () => {
      mockReq.body = {
        email: 'test@test.com',
        name: 'A',
        password: 'password123',
      };

      await createUser(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Bad Request',
          message: expect.stringContaining('Nome'),
        })
      );
    });

    it('should return 400 if password is too short', async () => {
      mockReq.body = {
        email: 'test@test.com',
        name: 'Test User',
        password: '12345',
      };

      await createUser(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Bad Request',
          message: expect.stringContaining('Senha'),
        })
      );
    });

    it('should return 400 if role is invalid', async () => {
      mockReq.body = {
        email: 'test@test.com',
        name: 'Test User',
        password: 'password123',
        role: 'INVALID_ROLE',
      };

      await createUser(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Bad Request',
          message: expect.stringContaining('Role'),
        })
      );
    });

    it('should return 404 if supervisor does not exist', async () => {
      mockReq.body = {
        email: 'test@test.com',
        name: 'Test User',
        password: 'password123',
        supervisorId: 'non-existent-id',
      };
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await createUser(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Not Found',
          message: 'Supervisor não encontrado',
        })
      );
    });

    it('should return 409 if email already exists', async () => {
      mockReq.body = {
        email: 'existing@test.com',
        name: 'Test User',
        password: 'password123',
      };
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

      await createUser(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Conflict',
        })
      );
    });

    it('should create user successfully', async () => {
      const mockUser = {
        id: 'new-user-123',
        email: 'new@test.com',
        name: 'New User',
        role: 'MEMBER',
        supervisor: null,
        createdAt: new Date(),
      };

      mockReq.body = {
        email: 'new@test.com',
        name: 'New User',
        password: 'password123',
        role: 'MEMBER',
      };

      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockSupabaseAdmin.auth.admin.createUser.mockResolvedValue({
        data: { user: { id: 'new-user-123' } },
        error: null,
      });
      mockPrisma.user.create.mockResolvedValue(mockUser);

      await createUser(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Usuário criado com sucesso',
          user: expect.objectContaining({
            id: 'new-user-123',
            email: 'new@test.com',
          }),
        })
      );
    });
  });

  describe('updateUser', () => {
    it('should return 404 if user does not exist', async () => {
      mockReq.params = { id: 'non-existent-id' };
      mockReq.body = { name: 'Updated Name' };
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await updateUser(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Not Found',
          message: 'Usuário não encontrado',
        })
      );
    });

    it('should return 400 if user tries to be their own supervisor', async () => {
      mockReq.params = { id: 'user-123' };
      mockReq.body = { supervisorId: 'user-123' };
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-123' });

      await updateUser(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Bad Request',
          message: expect.stringContaining('supervisor'),
        })
      );
    });

    it('should update user successfully', async () => {
      const existingUser = {
        id: 'user-123',
        email: 'user@test.com',
        name: 'Old Name',
        role: 'MEMBER',
      };

      const updatedUser = {
        ...existingUser,
        name: 'New Name',
        supervisor: null,
      };

      mockReq.params = { id: 'user-123' };
      mockReq.body = { name: 'New Name' };
      mockPrisma.user.findUnique.mockResolvedValue(existingUser);
      mockPrisma.user.update.mockResolvedValue(updatedUser);

      await updateUser(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Usuário atualizado com sucesso',
        })
      );
    });
  });

  describe('listUsers', () => {
    it('should return paginated users for admin', async () => {
      const mockUsers = [
        { id: 'user-1', email: 'user1@test.com', name: 'User 1', role: 'MEMBER' },
        { id: 'user-2', email: 'user2@test.com', name: 'User 2', role: 'SUPERVISOR' },
      ];

      mockPrisma.user.findMany.mockResolvedValue(mockUsers);
      mockPrisma.user.count.mockResolvedValue(2);
      mockReq.query = { page: '1', limit: '10' };

      await listUsers(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          users: expect.any(Array),
          pagination: expect.objectContaining({
            page: 1,
            total: 2,
          }),
        })
      );
    });

    it('should filter users by role', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);
      mockReq.query = { role: 'SUPERVISOR' };

      await listUsers(mockReq, mockRes);

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            role: 'SUPERVISOR',
          }),
        })
      );
    });

    it('should filter users by search term', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);
      mockReq.query = { search: 'john' };

      await listUsers(mockReq, mockRes);

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.any(Array),
          }),
        })
      );
    });
  });

  describe('getUserById', () => {
    it('should return 404 if user does not exist', async () => {
      mockReq.params = { id: 'non-existent-id' };
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await getUserById(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should return user details', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'user@test.com',
        name: 'Test User',
        role: 'MEMBER',
        supervisor: { id: 'sup-123', name: 'Supervisor' },
        subordinates: [],
        _count: { timeEntries: 10 },
      };

      mockReq.params = { id: 'user-123' };
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await getUserById(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          user: expect.objectContaining({
            id: 'user-123',
            email: 'user@test.com',
          }),
        })
      );
    });
  });

  describe('deleteUser', () => {
    it('should return 404 if user does not exist', async () => {
      mockReq.params = { id: 'non-existent-id' };
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await deleteUser(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 if trying to delete self', async () => {
      mockReq.params = { id: 'admin-123' };
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'admin-123' });

      await deleteUser(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Bad Request',
          message: expect.stringContaining('própria conta'),
        })
      );
    });

    it('should delete user successfully', async () => {
      mockReq.params = { id: 'user-123' };
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-123',
        email: 'user@test.com',
      });
      mockSupabaseAdmin.auth.admin.deleteUser.mockResolvedValue({ error: null });
      mockPrisma.user.delete.mockResolvedValue({ id: 'user-123' });

      await deleteUser(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Usuário deletado com sucesso',
        })
      );
    });
  });

  describe('Error handling', () => {
    it('should handle database errors', async () => {
      mockReq.body = {
        email: 'test@test.com',
        name: 'Test User',
        password: 'password123',
      };
      mockPrisma.user.findUnique.mockRejectedValue(new Error('DB Error'));

      await createUser(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });
});
