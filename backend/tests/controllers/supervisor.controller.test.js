// Testes para supervisor.controller

const mockPrisma = require('../mocks/prisma.mock');

// Mock dos módulos
jest.mock('../../src/config/database', () => mockPrisma);

const {
  getTeamPendingEntries,
  approveEntry,
  rejectEntry,
  requestEdit,
  getTeamMembers,
} = require('../../src/controllers/supervisor.controller');

describe('Supervisor Controller', () => {
  let mockReq;
  let mockRes;

  beforeEach(() => {
    mockReq = {
      user: {
        id: 'supervisor-123',
        email: 'supervisor@test.com',
        role: 'SUPERVISOR',
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

  describe('getTeamPendingEntries', () => {
    it('should return empty array if supervisor has no subordinates', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      await getTeamPendingEntries(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Nenhum subordinado encontrado',
          entries: [],
        })
      );
    });

    it('should return pending entries for subordinates', async () => {
      const subordinates = [
        { id: 'member-1', name: 'Member 1', email: 'member1@test.com' },
        { id: 'member-2', name: 'Member 2', email: 'member2@test.com' },
      ];

      const entries = [
        {
          id: 'entry-1',
          userId: 'member-1',
          status: 'PENDING',
          clockIn: new Date(),
          clockOut: new Date(),
          user: subordinates[0],
          logs: [],
        },
      ];

      mockPrisma.user.findMany.mockResolvedValue(subordinates);
      mockPrisma.timeEntry.findMany.mockResolvedValue(entries);
      mockPrisma.timeEntry.count.mockResolvedValue(1);
      mockPrisma.timeEntry.groupBy.mockResolvedValue([
        { status: 'PENDING', _count: 1 },
      ]);

      await getTeamPendingEntries(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          entries: expect.any(Array),
          subordinates: expect.any(Array),
          stats: expect.any(Object),
        })
      );
    });

    it('should return 403 if userId is not a subordinate', async () => {
      const subordinates = [
        { id: 'member-1', name: 'Member 1', email: 'member1@test.com' },
      ];

      mockPrisma.user.findMany.mockResolvedValue(subordinates);
      mockReq.query = { userId: 'other-user' };

      await getTeamPendingEntries(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Forbidden',
        })
      );
    });

    it('should filter by status', async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'member-1' }]);
      mockPrisma.timeEntry.findMany.mockResolvedValue([]);
      mockPrisma.timeEntry.count.mockResolvedValue(0);
      mockPrisma.timeEntry.groupBy.mockResolvedValue([]);
      mockReq.query = { status: 'APPROVED' };

      await getTeamPendingEntries(mockReq, mockRes);

      expect(mockPrisma.timeEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'APPROVED',
          }),
        })
      );
    });
  });

  describe('approveEntry', () => {
    it('should return 404 if entry does not exist', async () => {
      mockReq.params = { id: 'non-existent-entry' };
      mockPrisma.timeEntry.findUnique.mockResolvedValue(null);

      await approveEntry(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Not Found',
          message: 'Registro de ponto não encontrado',
        })
      );
    });

    it('should return 403 if entry belongs to non-subordinate', async () => {
      mockReq.params = { id: 'entry-123' };
      mockPrisma.timeEntry.findUnique.mockResolvedValue({
        id: 'entry-123',
        user: {
          id: 'other-user',
          supervisorId: 'other-supervisor',
        },
      });

      await approveEntry(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Forbidden',
        })
      );
    });

    it('should return 400 if entry is not pending', async () => {
      mockReq.params = { id: 'entry-123' };
      mockPrisma.timeEntry.findUnique.mockResolvedValue({
        id: 'entry-123',
        status: 'APPROVED',
        clockOut: new Date(),
        user: {
          id: 'member-123',
          supervisorId: 'supervisor-123',
        },
      });

      await approveEntry(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Bad Request',
          message: expect.stringContaining('não pode ser aprovado'),
        })
      );
    });

    it('should return 400 if entry has no clock-out', async () => {
      mockReq.params = { id: 'entry-123' };
      mockPrisma.timeEntry.findUnique.mockResolvedValue({
        id: 'entry-123',
        status: 'PENDING',
        clockOut: null,
        user: {
          id: 'member-123',
          supervisorId: 'supervisor-123',
        },
      });

      await approveEntry(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Bad Request',
          message: expect.stringContaining('sem clock-out'),
        })
      );
    });

    it('should approve entry successfully', async () => {
      mockReq.params = { id: 'entry-123' };
      mockReq.body = { comment: 'Looks good!' };

      mockPrisma.timeEntry.findUnique.mockResolvedValue({
        id: 'entry-123',
        status: 'PENDING',
        clockOut: new Date(),
        user: {
          id: 'member-123',
          supervisorId: 'supervisor-123',
        },
      });

      const updatedEntry = {
        id: 'entry-123',
        status: 'APPROVED',
        user: { id: 'member-123', name: 'Member', email: 'member@test.com' },
      };

      const approvalLog = {
        id: 'log-123',
        timeEntryId: 'entry-123',
        reviewerId: 'supervisor-123',
        action: 'APPROVED',
        comment: 'Looks good!',
      };

      mockPrisma.$transaction.mockResolvedValue([updatedEntry, approvalLog]);

      await approveEntry(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Registro aprovado com sucesso',
          entry: expect.any(Object),
          approvalLog: expect.any(Object),
        })
      );
    });
  });

  describe('rejectEntry', () => {
    it('should return 400 if comment is missing', async () => {
      mockReq.params = { id: 'entry-123' };
      mockReq.body = {};

      await rejectEntry(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Bad Request',
          message: expect.stringContaining('Comentário obrigatório'),
        })
      );
    });

    it('should return 400 if comment is too short', async () => {
      mockReq.params = { id: 'entry-123' };
      mockReq.body = { comment: 'No' };

      await rejectEntry(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Bad Request',
          message: expect.stringContaining('mínimo'),
        })
      );
    });

    it('should reject entry successfully', async () => {
      mockReq.params = { id: 'entry-123' };
      mockReq.body = { comment: 'Incorrect hours reported' };

      mockPrisma.timeEntry.findUnique.mockResolvedValue({
        id: 'entry-123',
        status: 'PENDING',
        user: {
          id: 'member-123',
          supervisorId: 'supervisor-123',
        },
      });

      const updatedEntry = {
        id: 'entry-123',
        status: 'REJECTED',
        user: { id: 'member-123', name: 'Member', email: 'member@test.com' },
      };

      const approvalLog = {
        id: 'log-123',
        action: 'REJECTED',
        comment: 'Incorrect hours reported',
      };

      mockPrisma.$transaction.mockResolvedValue([updatedEntry, approvalLog]);

      await rejectEntry(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Registro rejeitado',
        })
      );
    });
  });

  describe('requestEdit', () => {
    it('should return 400 if comment is missing', async () => {
      mockReq.params = { id: 'entry-123' };
      mockReq.body = {};

      await requestEdit(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should request edit successfully', async () => {
      mockReq.params = { id: 'entry-123' };
      mockReq.body = { comment: 'Please verify the clock-in time' };

      mockPrisma.timeEntry.findUnique.mockResolvedValue({
        id: 'entry-123',
        user: {
          id: 'member-123',
          supervisorId: 'supervisor-123',
        },
      });

      const updatedEntry = {
        id: 'entry-123',
        status: 'PENDING',
        user: { id: 'member-123', name: 'Member', email: 'member@test.com' },
      };

      const approvalLog = {
        id: 'log-123',
        action: 'EDIT_REQUESTED',
        comment: 'Please verify the clock-in time',
      };

      mockPrisma.$transaction.mockResolvedValue([updatedEntry, approvalLog]);

      await requestEdit(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Solicitação de edição'),
        })
      );
    });
  });

  describe('getTeamMembers', () => {
    it('should return team members with stats', async () => {
      const subordinates = [
        {
          id: 'member-1',
          name: 'Member 1',
          email: 'member1@test.com',
          role: 'MEMBER',
          createdAt: new Date(),
          _count: { timeEntries: 10 },
        },
      ];

      mockPrisma.user.findMany.mockResolvedValue(subordinates);
      mockPrisma.timeEntry.groupBy.mockResolvedValue([
        { status: 'PENDING', _count: 3 },
        { status: 'APPROVED', _count: 7 },
      ]);

      await getTeamMembers(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          team: expect.any(Array),
          totalMembers: 1,
        })
      );
    });
  });

  describe('Error handling', () => {
    it('should handle database errors', async () => {
      mockPrisma.user.findMany.mockRejectedValue(new Error('DB Error'));

      await getTeamPendingEntries(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });
});
