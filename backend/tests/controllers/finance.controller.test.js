const mockPrisma = require('../mocks/prisma.mock');

jest.mock('../../src/config/database', () => mockPrisma);
jest.mock('../../src/utils/seatBilling', () => ({
  listAdminCheckoutSessions: jest.fn(),
  getSubscriptionSnapshot: jest.fn(),
}));

const {
  listAdminCheckoutSessions,
  getSubscriptionSnapshot,
} = require('../../src/utils/seatBilling');

const {
  getMyFinanceOverview,
  syncMyFinanceInvoices,
  listMyFinanceInvoices,
} = require('../../src/controllers/finance.controller');

describe('Finance Controller', () => {
  let mockReq;
  let mockRes;

  beforeEach(() => {
    mockReq = {
      user: {
        id: 'admin-123',
        role: 'ADMIN',
      },
      query: {},
      body: {},
      params: {},
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    jest.clearAllMocks();
  });

  describe('getMyFinanceOverview', () => {
    it('should block non-admin users', async () => {
      mockReq.user.role = 'HR';

      await getMyFinanceOverview(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Forbidden',
        })
      );
    });

    it('should return finance overview for admin', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'admin-123',
        email: 'admin@test.com',
        role: 'ADMIN',
        adminPlanStatus: 'ACTIVE',
        adminPlanLinkedAt: new Date('2026-04-01T00:00:00.000Z'),
        adminSeatLimit: 7,
        adminExtraSeatPrice: 7.5,
        adminPlan: {
          id: 'plan-1',
          code: 'PRO',
          name: 'Pro',
          monthlyPrice: 50,
          isActive: true,
        },
      });

      mockPrisma.user.count.mockResolvedValue(4);
      mockPrisma.adminBillingInvoice.findFirst.mockResolvedValue({
        stripeSubscriptionId: 'sub_123',
        paidAt: new Date('2026-04-10T10:00:00.000Z'),
      });

      getSubscriptionSnapshot.mockResolvedValue({
        ok: true,
        status: 'active',
        currentPeriodEnd: '2026-05-10T10:00:00.000Z',
      });

      await getMyFinanceOverview(mockReq, mockRes);

      expect(mockPrisma.user.findUnique).toHaveBeenCalled();
      expect(mockPrisma.user.count).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          plan: expect.objectContaining({
            code: 'PRO',
            status: 'ACTIVE',
            nextBillingAt: '2026-05-10T10:00:00.000Z',
          }),
          billing: expect.objectContaining({
            activeSeats: 4,
            seatLimit: 7,
          }),
        })
      );
    });
  });

  describe('syncMyFinanceInvoices', () => {
    it('should sync sessions and upsert invoices', async () => {
      listAdminCheckoutSessions.mockResolvedValue({
        ok: true,
        reason: null,
        sessions: [
          {
            id: 'cs_test_1',
            metadata: {
              type: 'additional_admin_seats',
              adminUserId: 'admin-123',
              overageSeats: '2',
              expectedMonthlyAmountUsd: '15.00',
            },
            status: 'complete',
            payment_status: 'paid',
            mode: 'subscription',
            currency: 'usd',
            amount_total: 1500,
            amount_subtotal: 1500,
            created: 1712764800,
            customer_email: 'admin@test.com',
            invoice: 'in_1',
            subscription: 'sub_1',
          },
        ],
      });

      mockPrisma.adminBillingInvoice.upsert.mockResolvedValue({ id: 'inv-db-1' });
      mockPrisma.adminBillingInvoice.count.mockResolvedValue(1);

      await syncMyFinanceInvoices(mockReq, mockRes);

      expect(listAdminCheckoutSessions).toHaveBeenCalledWith(
        expect.objectContaining({
          adminUserId: 'admin-123',
        })
      );
      expect(mockPrisma.adminBillingInvoice.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            stripeSessionId: 'cs_test_1',
          },
        })
      );
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          stripe: expect.objectContaining({
            configured: true,
            sessionsScanned: 1,
          }),
          sync: expect.objectContaining({
            invoicesUpserted: 1,
          }),
        })
      );
    });
  });

  describe('listMyFinanceInvoices', () => {
    it('should list paid invoices with pagination', async () => {
      mockReq.query = {
        page: '1',
        limit: '10',
      };

      mockPrisma.adminBillingInvoice.count.mockResolvedValue(1);
      mockPrisma.adminBillingInvoice.findMany.mockResolvedValue([
        {
          id: 'inv-db-1',
          sourceType: 'ADDITIONAL_SEATS',
          stripeSessionId: 'cs_test_1',
          stripeInvoiceId: 'in_1',
          stripeSubscriptionId: 'sub_1',
          status: 'complete',
          paymentStatus: 'paid',
          mode: 'subscription',
          currency: 'USD',
          amountTotal: 15,
          amountSubtotal: 15,
          expectedMonthlyAmountUsd: 15,
          overageSeats: 2,
          customerEmail: 'admin@test.com',
          sessionCreatedAt: new Date('2026-04-10T10:00:00.000Z'),
          paidAt: new Date('2026-04-10T10:00:00.000Z'),
          syncedAt: new Date('2026-04-10T10:01:00.000Z'),
          createdAt: new Date('2026-04-10T10:01:00.000Z'),
        },
      ]);

      await listMyFinanceInvoices(mockReq, mockRes);

      expect(mockPrisma.adminBillingInvoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            adminUserId: 'admin-123',
            OR: expect.any(Array),
          }),
          take: 10,
        })
      );

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          invoices: expect.any(Array),
          pagination: expect.objectContaining({
            page: 1,
            limit: 10,
            total: 1,
          }),
        })
      );
    });

    it('should reject invalid status filter', async () => {
      mockReq.query = { status: 'unknown' };

      await listMyFinanceInvoices(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Bad Request',
        })
      );
    });
  });
});
