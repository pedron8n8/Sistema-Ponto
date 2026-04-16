// Testes de integração para as rotas

const request = require('supertest');
const express = require('express');
const { hashPin } = require('../../src/utils/pinAuth');

// Mock completo do Prisma antes de importar as rotas
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  adminPlan: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  adminBillingInvoice: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  timeEntry: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  approvalLog: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  bankHoursEntry: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  $transaction: jest.fn((callbacks) => Promise.all(callbacks)),
  $connect: jest.fn(),
  $disconnect: jest.fn(),
};

const mockSupabaseAdmin = {
  auth: {
    admin: {
      createUser: jest.fn(),
      updateUserById: jest.fn(),
      deleteUser: jest.fn(),
    },
    getUser: jest.fn(),
  },
};

const mockSupabase = {
  auth: {
    getUser: jest.fn(),
  },
};

const mockReportQueue = {
  add: jest.fn(),
  getJob: jest.fn(),
  getCompleted: jest.fn().mockResolvedValue([]),
};

// Mock dos módulos
jest.mock('../../src/config/database', () => mockPrisma);
jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: mockSupabaseAdmin,
  supabase: mockSupabase,
}));
jest.mock('../../src/config/redis', () => ({
  on: jest.fn(),
}));
jest.mock('../../src/workers/reportWorker', () => ({
  reportQueue: mockReportQueue,
  REPORTS_DIR: 'C:/tmp/reports',
  createReportWorker: jest.fn(),
}));

// Cria uma app Express para testes
const createTestApp = () => {
  const app = express();
  app.use(express.json());

  // Mock do authMiddleware para testes
  const mockAuthMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Simula diferentes usuários baseado no token
    const token = authHeader.split(' ')[1];
    if (token === 'admin-token') {
      req.user = {
        id: 'admin-123',
        email: 'admin@test.com',
        role: 'ADMIN',
        adminPlanId: 'plan-base-123',
        adminPlanStatus: 'ACTIVE',
        currentPlan: 'PRO',
        currentPlanStatus: 'ACTIVE',
        adminSeatLimit: 10,
        adminExtraSeatPrice: 10,
      };
    } else if (token === 'supervisor-token') {
      req.user = {
        id: 'supervisor-123',
        email: 'supervisor@test.com',
        role: 'SUPERVISOR',
        organizationAdminId: 'admin-123',
        currentPlan: 'PRO',
        currentPlanStatus: 'ACTIVE',
      };
    } else if (token === 'member-token') {
      req.user = {
        id: 'member-123',
        email: 'member@test.com',
        role: 'MEMBER',
        organizationAdminId: 'admin-123',
        currentPlan: 'PRO',
        currentPlanStatus: 'ACTIVE',
      };
    } else {
      return res.status(401).json({ error: 'Invalid token' });
    }
    next();
  };

  // Substitui o middleware de auth
  jest.doMock('../../src/middlewares/auth.middleware', () => mockAuthMiddleware);

  const routes = require('../../src/routes');
  app.use('/api/v1', routes);

  return app;
};

describe('API Routes Integration Tests', () => {
  let app;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Health Check', () => {
    it('GET /api/v1/health should return ok', async () => {
      const res = await request(app).get('/api/v1/health');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('timestamp');
    });
  });

  describe('Auth Routes', () => {
    it('GET /api/v1/auth/me without token should return 401', async () => {
      const res = await request(app).get('/api/v1/auth/me');

      expect(res.status).toBe(401);
    });

    it('GET /api/v1/auth/me with valid token should return user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'admin-123',
        email: 'admin@test.com',
        role: 'ADMIN',
      });

      mockSupabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: { id: 'admin-123', email: 'admin@test.com' } },
        error: null,
      });

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(200);
    });
  });

  describe('Time Routes', () => {
    beforeEach(() => {
      const { hash, salt } = hashPin('1234');

      mockSupabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: { id: 'member-123', email: 'member@test.com' } },
        error: null,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'member-123',
        email: 'member@test.com',
        role: 'MEMBER',
        facialEmbedding: null,
        facialThreshold: 0.6,
        pinHash: hash,
        pinSalt: salt,
        pinFailedAttempts: 0,
        pinLockedUntil: null,
        contractDailyMinutes: 480,
        hourlyRate: 10,
        bankHoursBalanceMinutes: 0,
        bankHoursLimitMinutes: null,
        bankHoursExpiryMonths: 6,
        bankHoursPolicyCode: 'DEFAULT',
      });
      mockPrisma.user.update.mockResolvedValue({ bankHoursBalanceMinutes: 0 });
      mockPrisma.bankHoursEntry.findMany.mockResolvedValue([]);
      mockPrisma.bankHoursEntry.create.mockResolvedValue({ id: 'bhe-1' });
      mockPrisma.bankHoursEntry.updateMany.mockResolvedValue({ count: 0 });
    });

    it('POST /api/v1/time/clock-in should create a time entry', async () => {
      mockPrisma.timeEntry.findFirst.mockResolvedValue(null);
      mockPrisma.timeEntry.create.mockResolvedValue({
        id: 'entry-123',
        userId: 'member-123',
        clockIn: new Date(),
        status: 'PENDING',
        user: { id: 'member-123', email: 'member@test.com' },
      });

      const res = await request(app)
        .post('/api/v1/time/clock-in')
        .set('Authorization', 'Bearer member-token')
        .send({ notes: 'Starting work', pin: '1234' });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('message', 'Clock-in registrado com sucesso');
    });

    it('POST /api/v1/time/clock-in should fail if already clocked in', async () => {
      mockPrisma.timeEntry.findFirst.mockResolvedValue({
        id: 'entry-123',
        clockIn: new Date(),
        clockOut: null,
      });

      const res = await request(app)
        .post('/api/v1/time/clock-in')
        .set('Authorization', 'Bearer member-token')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('já possui um ponto aberto');
    });

    it('POST /api/v1/time/clock-out should close a time entry', async () => {
      mockPrisma.timeEntry.findFirst.mockResolvedValue({
        id: 'entry-123',
        clockIn: new Date(Date.now() - 8 * 60 * 60 * 1000),
        clockOut: null,
      });
      mockPrisma.timeEntry.update.mockResolvedValue({
        id: 'entry-123',
        clockIn: new Date(Date.now() - 8 * 60 * 60 * 1000),
        clockOut: new Date(),
        user: { id: 'member-123', email: 'member@test.com' },
      });

      const res = await request(app)
        .post('/api/v1/time/clock-out')
        .set('Authorization', 'Bearer member-token')
        .send({ notes: 'Ending work', pin: '1234' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message', 'Clock-out registrado com sucesso');
    });

    it('GET /api/v1/time/me should return user entries', async () => {
      mockPrisma.timeEntry.findMany.mockResolvedValue([]);
      mockPrisma.timeEntry.count.mockResolvedValue(0);

      const res = await request(app)
        .get('/api/v1/time/me')
        .set('Authorization', 'Bearer member-token');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('entries');
      expect(res.body).toHaveProperty('pagination');
    });
  });

  describe('User Routes', () => {
    beforeEach(() => {
      mockSupabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: { id: 'admin-123', email: 'admin@test.com' } },
        error: null,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'admin-123',
        email: 'admin@test.com',
        role: 'ADMIN',
        adminPlanId: 'plan-base-123',
        adminPlanStatus: 'ACTIVE',
        adminSeatLimit: 10,
        adminExtraSeatPrice: 10,
      });
    });

    it('GET /api/v1/users should return user list for admin', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'user-1', email: 'user1@test.com', role: 'MEMBER' },
      ]);
      mockPrisma.user.count.mockResolvedValue(1);

      const res = await request(app)
        .get('/api/v1/users')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('users');
    });

    it('GET /api/v1/users should fail for member', async () => {
      mockSupabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: { id: 'member-123', email: 'member@test.com' } },
        error: null,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'member-123',
        email: 'member@test.com',
        role: 'MEMBER',
      });

      const res = await request(app)
        .get('/api/v1/users')
        .set('Authorization', 'Bearer member-token');

      expect(res.status).toBe(403);
    });

    it('POST /api/v1/users should create user', async () => {
      mockPrisma.user.findUnique.mockImplementation(({ where }) => {
        if (where.id === 'admin-123') {
          return {
            id: 'admin-123',
            email: 'admin@test.com',
            role: 'ADMIN',
            adminPlanId: 'plan-base-123',
            adminPlanStatus: 'ACTIVE',
            adminSeatLimit: 10,
            adminExtraSeatPrice: 10,
          };
        }
        return null;
      });
      mockPrisma.user.count.mockResolvedValue(0);

      mockSupabaseAdmin.auth.admin.createUser.mockResolvedValue({
        data: { user: { id: 'new-user' } },
        error: null,
      });

      mockPrisma.user.create.mockResolvedValue({
        id: 'new-user',
        email: 'new@test.com',
        name: 'New User',
        role: 'MEMBER',
        supervisor: null,
        createdAt: new Date(),
      });

      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', 'Bearer admin-token')
        .send({
          email: 'new@test.com',
          name: 'New User',
          password: 'password123',
          role: 'MEMBER',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('message', 'Usuário criado com sucesso');
    });
  });

  describe('Supervisor Routes', () => {
    beforeEach(() => {
      mockSupabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: { id: 'supervisor-123', email: 'supervisor@test.com' } },
        error: null,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'supervisor-123',
        email: 'supervisor@test.com',
        role: 'SUPERVISOR',
      });
    });

    it('GET /api/v1/supervisor/entries should return pending entries', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'member-1', name: 'Member 1', email: 'member1@test.com' },
      ]);
      mockPrisma.timeEntry.findMany.mockResolvedValue([]);
      mockPrisma.timeEntry.count.mockResolvedValue(0);
      mockPrisma.timeEntry.groupBy.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/v1/supervisor/entries')
        .set('Authorization', 'Bearer supervisor-token');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('entries');
    });

    it('GET /api/v1/supervisor/team should return team members', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.timeEntry.groupBy.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/v1/supervisor/team')
        .set('Authorization', 'Bearer supervisor-token');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('team');
    });
  });

  describe('Admin Routes', () => {
    beforeEach(() => {
      mockSupabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: { id: 'admin-123', email: 'admin@test.com' } },
        error: null,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'admin-123',
        email: 'admin@test.com',
        role: 'ADMIN',
      });
    });

    it('GET /api/v1/admin/stats should return system stats', async () => {
      mockPrisma.user.groupBy.mockResolvedValue([]);
      mockPrisma.timeEntry.groupBy.mockResolvedValue([]);
      mockPrisma.timeEntry.count.mockResolvedValue(0);
      mockPrisma.timeEntry.findMany.mockResolvedValue([]);
      mockPrisma.approvalLog.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/v1/admin/stats')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('users');
      expect(res.body).toHaveProperty('timeEntries');
    });

    it('GET /api/v1/admin/audit/:id should return audit log', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValue({
        id: 'entry-123',
        clockIn: new Date(),
        clockOut: new Date(),
        status: 'APPROVED',
        user: {
          id: 'user-123',
          name: 'Test',
          email: 'test@test.com',
          role: 'MEMBER',
          supervisor: null,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.approvalLog.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/v1/admin/audit/entry-123')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('timeEntry');
      expect(res.body).toHaveProperty('auditLogs');
      expect(res.body).toHaveProperty('timeline');
    });

    it('GET /api/v1/admin/stats should fail for non-admin', async () => {
      mockSupabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: { id: 'member-123', email: 'member@test.com' } },
        error: null,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'member-123',
        email: 'member@test.com',
        role: 'MEMBER',
      });

      const res = await request(app)
        .get('/api/v1/admin/stats')
        .set('Authorization', 'Bearer member-token');

      expect(res.status).toBe(403);
    });
  });

  describe('Reports Routes', () => {
    beforeEach(() => {
      mockReportQueue.getCompleted.mockResolvedValue([]);
      mockSupabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: { id: 'admin-123', email: 'admin@test.com' } },
        error: null,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'admin-123',
        email: 'admin@test.com',
        role: 'ADMIN',
      });
    });

    it('GET /api/v1/reports/list should return reports list', async () => {
      const res = await request(app)
        .get('/api/v1/reports/list')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('reports');
    });
  });
});
