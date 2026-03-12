// Testes para admin.controller

const mockPrisma = require('../mocks/prisma.mock');

// Mock dos módulos
jest.mock('../../src/config/database', () => mockPrisma);

const {
  getTimeEntryAuditLog,
  getUserTimeEntries,
  changeUserSupervisor,
  getSystemStats,
  getTeamOverview,
} = require('../../src/controllers/admin.controller');

describe('Admin Controller', () => {
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

  describe('getTimeEntryAuditLog', () => {
    it('should return 404 if time entry does not exist', async () => {
      mockReq.params = { timeEntryId: 'non-existent' };
      mockPrisma.timeEntry.findUnique.mockResolvedValue(null);

      await getTimeEntryAuditLog(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Not Found',
          message: 'Registro de ponto não encontrado',
        })
      );
    });

    it('should return complete audit log with timeline', async () => {
      const timeEntry = {
        id: 'entry-123',
        userId: 'user-123',
        clockIn: new Date('2026-03-12T09:00:00Z'),
        clockOut: new Date('2026-03-12T18:00:00Z'),
        status: 'APPROVED',
        notes: 'Regular workday',
        ipAddress: '192.168.1.1',
        device: 'Chrome on Windows',
        location: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          id: 'user-123',
          name: 'Test User',
          email: 'user@test.com',
          role: 'MEMBER',
          supervisor: {
            id: 'supervisor-123',
            name: 'Supervisor',
            email: 'supervisor@test.com',
          },
        },
      };

      const auditLogs = [
        {
          id: 'log-1',
          timeEntryId: 'entry-123',
          action: 'APPROVED',
          comment: 'Looks good',
          timestamp: new Date('2026-03-12T19:00:00Z'),
          reviewer: {
            id: 'supervisor-123',
            name: 'Supervisor',
            email: 'supervisor@test.com',
            role: 'SUPERVISOR',
          },
        },
      ];

      mockReq.params = { timeEntryId: 'entry-123' };
      mockPrisma.timeEntry.findUnique.mockResolvedValue(timeEntry);
      mockPrisma.approvalLog.findMany.mockResolvedValue(auditLogs);

      await getTimeEntryAuditLog(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          timeEntry: expect.objectContaining({
            id: 'entry-123',
            status: 'APPROVED',
          }),
          auditLogs: expect.any(Array),
          timeline: expect.any(Array),
          summary: expect.objectContaining({
            totalEvents: expect.any(Number),
            currentStatus: 'APPROVED',
          }),
        })
      );
    });

    it('should calculate duration correctly', async () => {
      const timeEntry = {
        id: 'entry-123',
        clockIn: new Date('2026-03-12T09:00:00Z'),
        clockOut: new Date('2026-03-12T17:30:00Z'), // 8h 30m
        status: 'APPROVED',
        user: { id: 'user-123', name: 'Test', email: 'test@test.com', role: 'MEMBER' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockReq.params = { timeEntryId: 'entry-123' };
      mockPrisma.timeEntry.findUnique.mockResolvedValue(timeEntry);
      mockPrisma.approvalLog.findMany.mockResolvedValue([]);

      await getTimeEntryAuditLog(mockReq, mockRes);

      const response = mockRes.json.mock.calls[0][0];
      expect(response.timeEntry.duration).toEqual(
        expect.objectContaining({
          hours: 8,
          minutes: 30,
          formatted: '8h 30m',
        })
      );
    });
  });

  describe('getUserTimeEntries', () => {
    it('should return 404 if user does not exist', async () => {
      mockReq.params = { userId: 'non-existent' };
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await getUserTimeEntries(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Not Found',
          message: 'Usuário não encontrado',
        })
      );
    });

    it('should return user entries with stats', async () => {
      const user = {
        id: 'user-123',
        name: 'Test User',
        email: 'user@test.com',
        role: 'MEMBER',
        supervisor: { id: 'sup-123', name: 'Supervisor', email: 'sup@test.com' },
      };

      const entries = [
        {
          id: 'entry-1',
          clockIn: new Date(),
          clockOut: new Date(),
          status: 'APPROVED',
          logs: [],
        },
      ];

      mockReq.params = { userId: 'user-123' };
      mockReq.query = { page: '1', limit: '10' };
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.timeEntry.findMany.mockResolvedValue(entries);
      mockPrisma.timeEntry.count.mockResolvedValue(1);
      mockPrisma.timeEntry.groupBy.mockResolvedValue([
        { status: 'APPROVED', _count: 1 },
      ]);

      await getUserTimeEntries(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          user: expect.any(Object),
          entries: expect.any(Array),
          stats: expect.any(Object),
          totalWorked: expect.any(Object),
          pagination: expect.any(Object),
        })
      );
    });

    it('should filter by date range', async () => {
      mockReq.params = { userId: 'user-123' };
      mockReq.query = { startDate: '2026-03-01', endDate: '2026-03-12' };
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-123' });
      mockPrisma.timeEntry.findMany.mockResolvedValue([]);
      mockPrisma.timeEntry.count.mockResolvedValue(0);
      mockPrisma.timeEntry.groupBy.mockResolvedValue([]);

      await getUserTimeEntries(mockReq, mockRes);

      expect(mockPrisma.timeEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            clockIn: expect.any(Object),
          }),
        })
      );
    });
  });

  describe('changeUserSupervisor', () => {
    it('should return 404 if user does not exist', async () => {
      mockReq.params = { userId: 'non-existent' };
      mockReq.body = { supervisorId: 'supervisor-123' };
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await changeUserSupervisor(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 if user tries to be their own supervisor', async () => {
      mockReq.params = { userId: 'user-123' };
      mockReq.body = { supervisorId: 'user-123' };
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-123' });

      await changeUserSupervisor(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Bad Request',
          message: expect.stringContaining('supervisor de si mesmo'),
        })
      );
    });

    it('should remove supervisor when supervisorId is null', async () => {
      mockReq.params = { userId: 'user-123' };
      mockReq.body = { supervisorId: null };
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-123',
        supervisorId: 'old-supervisor',
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-123',
        supervisorId: null,
        supervisor: null,
      });

      await changeUserSupervisor(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Supervisor removido com sucesso',
        })
      );
    });

    it('should return 404 if new supervisor does not exist', async () => {
      mockReq.params = { userId: 'user-123' };
      mockReq.body = { supervisorId: 'non-existent' };
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'user-123' })
        .mockResolvedValueOnce(null);

      await changeUserSupervisor(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Novo supervisor não encontrado',
        })
      );
    });

    it('should return 400 if new supervisor is not a supervisor or admin', async () => {
      mockReq.params = { userId: 'user-123' };
      mockReq.body = { supervisorId: 'member-123' };
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'user-123' })
        .mockResolvedValueOnce({ id: 'member-123', role: 'MEMBER' });

      await changeUserSupervisor(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Apenas Admin ou Supervisor'),
        })
      );
    });

    it('should change supervisor successfully', async () => {
      mockReq.params = { userId: 'user-123' };
      mockReq.body = { supervisorId: 'new-supervisor' };

      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'user-123', supervisorId: 'old-supervisor' })
        .mockResolvedValueOnce({ id: 'new-supervisor', role: 'SUPERVISOR', email: 'new@test.com' });

      mockPrisma.user.update.mockResolvedValue({
        id: 'user-123',
        supervisorId: 'new-supervisor',
        supervisor: { id: 'new-supervisor', name: 'New Supervisor' },
      });

      await changeUserSupervisor(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Supervisor alterado com sucesso',
          previousSupervisorId: 'old-supervisor',
          newSupervisorId: 'new-supervisor',
        })
      );
    });
  });

  describe('getSystemStats', () => {
    it('should return system statistics', async () => {
      mockPrisma.user.groupBy.mockResolvedValue([
        { role: 'ADMIN', _count: 1 },
        { role: 'SUPERVISOR', _count: 2 },
        { role: 'MEMBER', _count: 10 },
      ]);
      mockPrisma.timeEntry.groupBy.mockResolvedValue([
        { status: 'PENDING', _count: 5 },
        { status: 'APPROVED', _count: 100 },
        { status: 'REJECTED', _count: 3 },
      ]);
      mockPrisma.timeEntry.count
        .mockResolvedValueOnce(108) // total
        .mockResolvedValueOnce(5)  // pending
        .mockResolvedValueOnce(12); // today
      mockPrisma.timeEntry.findMany
        .mockResolvedValueOnce([{ userId: 'user-1' }, { userId: 'user-2' }]) // active today
        .mockResolvedValueOnce([]); // approved entries for hours
      mockPrisma.approvalLog.findMany.mockResolvedValue([]);

      await getSystemStats(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          users: expect.objectContaining({
            total: expect.any(Number),
            byRole: expect.any(Object),
          }),
          timeEntries: expect.any(Object),
          activity: expect.any(Object),
          recentApprovals: expect.any(Array),
        })
      );
    });
  });

  describe('getTeamOverview', () => {
    it('should return team overview with stats', async () => {
      const supervisors = [
        {
          id: 'sup-1',
          name: 'Supervisor 1',
          email: 'sup1@test.com',
          role: 'SUPERVISOR',
          subordinates: [
            { id: 'member-1', name: 'Member 1', email: 'member1@test.com', role: 'MEMBER' },
          ],
        },
      ];

      mockPrisma.user.findMany
        .mockResolvedValueOnce(supervisors)
        .mockResolvedValueOnce([]); // users without supervisor
      mockPrisma.timeEntry.groupBy.mockResolvedValue([
        { status: 'PENDING', _count: 2 },
      ]);

      await getTeamOverview(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          teams: expect.any(Array),
          usersWithoutSupervisor: expect.any(Array),
          summary: expect.any(Object),
        })
      );
    });
  });

  describe('Error handling', () => {
    it('should handle database errors', async () => {
      mockReq.params = { timeEntryId: 'entry-123' };
      mockPrisma.timeEntry.findUnique.mockRejectedValue(new Error('DB Error'));

      await getTimeEntryAuditLog(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Internal Server Error',
        })
      );
    });
  });
});
