const mockPrisma = require('../mocks/prisma.mock');

jest.mock('../../src/config/database', () => mockPrisma);

const {
  createVacationRequest,
  getMyVacationRequests,
  getHrVacationRequests,
} = require('../../src/controllers/vacation.controller');

describe('Vacation Controller', () => {
  let mockReq;
  let mockRes;

  beforeEach(() => {
    mockReq = {
      user: {
        id: 'member-1',
        email: 'member@test.com',
        role: 'MEMBER',
        supervisorId: 'supervisor-1',
      },
      body: {},
      query: {},
      params: {},
      protocol: 'http',
      get: jest.fn().mockReturnValue('localhost:3000'),
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    jest.clearAllMocks();

    mockPrisma.$transaction.mockImplementation((input) => {
      if (typeof input === 'function') {
        return input(mockPrisma);
      }

      if (Array.isArray(input)) {
        return Promise.all(input);
      }

      return Promise.resolve(input);
    });
  });

  describe('createVacationRequest', () => {
    it('should create DAY_OFF request and keep HR flow fields', async () => {
      mockReq.body = {
        requestType: 'DAY_OFF',
        startDate: '2026-04-20T12:00:00.000Z',
        endDate: '2026-04-20T13:00:00.000Z',
        reason: 'consulta medica',
      };

      mockPrisma.vacationRequest.findFirst.mockResolvedValue(null);
      mockPrisma.vacationRequest.create.mockResolvedValue({
        id: 'vac-1',
        startDate: new Date('2026-04-20T00:00:00.000Z'),
        endDate: new Date('2026-04-20T23:59:59.999Z'),
        reason: '[DAY_OFF] consulta medica',
        status: 'REQUESTED',
        user: {
          id: 'member-1',
          name: 'Member One',
          email: 'member@test.com',
        },
        supervisor: {
          id: 'supervisor-1',
          name: 'Supervisor One',
          email: 'supervisor@test.com',
        },
      });
      mockPrisma.vacationApprovalLog.create.mockResolvedValue({ id: 'log-1' });

      await createVacationRequest(mockReq, mockRes);

      expect(mockPrisma.vacationRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'member-1',
            supervisorId: 'supervisor-1',
            reason: '[DAY_OFF] consulta medica',
            status: 'REQUESTED',
          }),
        })
      );

      expect(mockRes.status).toHaveBeenCalledWith(201);
      const response = mockRes.json.mock.calls[0][0];
      expect(response.request).toEqual(
        expect.objectContaining({
          requestType: 'DAY_OFF',
          reason: 'consulta medica',
        })
      );
    });

    it('should reject DAY_OFF when period has more than one day', async () => {
      mockReq.body = {
        requestType: 'DAY_OFF',
        startDate: '2026-04-20',
        endDate: '2026-04-21',
      };

      await createVacationRequest(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Bad Request',
          message: 'Solicitação de folga deve ser para um único dia.',
        })
      );
      expect(mockPrisma.vacationRequest.create).not.toHaveBeenCalled();
    });
  });

  describe('request listing normalization', () => {
    it('should decode request type in my requests endpoint', async () => {
      mockPrisma.vacationRequest.findMany.mockResolvedValue([
        {
          id: 'vac-2',
          startDate: new Date('2026-04-22T00:00:00.000Z'),
          endDate: new Date('2026-04-22T23:59:59.999Z'),
          reason: '[DAY_OFF] descanso',
          status: 'REQUESTED',
          supervisor: null,
          hrReviewer: null,
          logs: [],
        },
      ]);

      await getMyVacationRequests(mockReq, mockRes);

      const response = mockRes.json.mock.calls[0][0];
      expect(response.requests[0]).toEqual(
        expect.objectContaining({
          requestType: 'DAY_OFF',
          reason: 'descanso',
        })
      );
    });

    it('should decode request type in HR requests endpoint', async () => {
      mockReq.user.role = 'HR';
      mockReq.query = { status: 'SUPERVISOR_APPROVED' };
      mockPrisma.vacationRequest.findMany.mockResolvedValue([
        {
          id: 'vac-3',
          startDate: new Date('2026-04-23T00:00:00.000Z'),
          endDate: new Date('2026-04-23T23:59:59.999Z'),
          reason: '[DAY_OFF] assunto pessoal',
          status: 'SUPERVISOR_APPROVED',
          user: {
            id: 'member-1',
            name: 'Member One',
            email: 'member@test.com',
            photoPath: null,
          },
          supervisor: null,
          hrReviewer: null,
          logs: [],
        },
      ]);

      await getHrVacationRequests(mockReq, mockRes);

      const response = mockRes.json.mock.calls[0][0];
      expect(response.requests[0]).toEqual(
        expect.objectContaining({
          requestType: 'DAY_OFF',
          reason: 'assunto pessoal',
        })
      );
    });
  });
});
