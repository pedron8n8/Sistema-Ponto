const prisma = require('../config/database');
const {
  listAdminCheckoutSessions,
  getSubscriptionSnapshot,
} = require('../utils/seatBilling');

const TEAM_MEMBER_ROLES = ['HR', 'SUPERVISOR', 'MEMBER'];
const PAID_PAYMENT_STATUSES = new Set(['paid', 'no_payment_required']);
const FINANCE_SOURCE_TYPES = {
  BASE_PLAN: 'BASE_PLAN',
  ADDITIONAL_SEATS: 'ADDITIONAL_SEATS',
};

const parsedExtraAdminSeatMonthlyUsd = Number(process.env.EXTRA_ADMIN_SEAT_MONTHLY_USD);
const EXTRA_ADMIN_SEAT_MONTHLY_USD = Number(
  (
    Number.isFinite(parsedExtraAdminSeatMonthlyUsd) && parsedExtraAdminSeatMonthlyUsd >= 0
      ? parsedExtraAdminSeatMonthlyUsd
      : 7.5
  ).toFixed(2)
);

const SELF_SERVICE_ADMIN_PLAN_CATALOG = {
  STARTER: {
    code: 'STARTER',
    maxSeats: 3,
  },
  GROWTH: {
    code: 'GROWTH',
    maxSeats: 5,
  },
  PRO: {
    code: 'PRO',
    maxSeats: 7,
  },
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toPositiveInteger = (value, fallback = 1) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : fallback;
};

const toIsoFromUnixSeconds = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return new Date(parsed * 1000).toISOString();
};

const fromMinorCurrencyToMajor = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number((parsed / 100).toFixed(2));
};

const normalizePlanCode = (value) => String(value || '').trim().toUpperCase();

const resolveIncludedSeatsForPlan = ({ planCode, seatLimit }) => {
  const normalizedPlanCode = normalizePlanCode(planCode);
  const plan = SELF_SERVICE_ADMIN_PLAN_CATALOG[normalizedPlanCode];

  if (plan) {
    return plan.maxSeats;
  }

  const parsedSeatLimit = Number(seatLimit);
  if (Number.isFinite(parsedSeatLimit) && parsedSeatLimit >= 0) {
    return Math.floor(parsedSeatLimit);
  }

  return 0;
};

const buildPersistedAdminSeatSnapshot = ({ planCode, seatLimit, occupiedSeats }) => {
  const normalizedOccupiedSeats = Math.max(0, Math.floor(Number(occupiedSeats) || 0));
  const normalizedSeatLimit = Number.isInteger(seatLimit) ? seatLimit : null;
  const includedSeats = resolveIncludedSeatsForPlan({
    planCode,
    seatLimit: normalizedSeatLimit,
  });

  return {
    seatLimit: normalizedSeatLimit,
    activeSeats: normalizedOccupiedSeats,
    contractedExtraSeats:
      normalizedSeatLimit === null ? 0 : Math.max(0, normalizedSeatLimit - includedSeats),
    availableSeats:
      normalizedSeatLimit === null ? null : Math.max(0, normalizedSeatLimit - normalizedOccupiedSeats),
    overageSeats:
      normalizedSeatLimit === null ? 0 : Math.max(0, normalizedOccupiedSeats - normalizedSeatLimit),
  };
};

const normalizePaymentStatus = (value) => String(value || '').trim().toLowerCase() || null;

const isPaidPaymentStatus = (value) => {
  const normalized = normalizePaymentStatus(value);
  return normalized ? PAID_PAYMENT_STATUSES.has(normalized) : false;
};

const mapSessionTypeToSourceType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();

  if (normalized === 'base_admin_plan') {
    return FINANCE_SOURCE_TYPES.BASE_PLAN;
  }

  if (normalized === 'additional_admin_seats') {
    return FINANCE_SOURCE_TYPES.ADDITIONAL_SEATS;
  }

  return null;
};

const normalizeSessionString = (value) => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

const buildInvoiceDataFromStripeSession = ({ adminUserId, session }) => {
  const stripeSessionId = normalizeSessionString(session?.id);
  const sourceType = mapSessionTypeToSourceType(session?.metadata?.type);

  if (!stripeSessionId || !sourceType) {
    return null;
  }

  const paymentStatus = normalizePaymentStatus(session?.payment_status);
  const createdAtIso = toIsoFromUnixSeconds(session?.created);
  const createdAtDate = createdAtIso ? new Date(createdAtIso) : null;
  const paidAtDate = paymentStatus && isPaidPaymentStatus(paymentStatus) ? createdAtDate : null;

  const expectedMonthlyAmountRaw = Number(session?.metadata?.expectedMonthlyAmountUsd);
  const expectedMonthlyAmountUsd = Number.isFinite(expectedMonthlyAmountRaw)
    ? Number(expectedMonthlyAmountRaw.toFixed(2))
    : null;

  const overageSeatsRaw = Number(session?.metadata?.overageSeats);
  const overageSeats = Number.isFinite(overageSeatsRaw)
    ? Math.max(0, Math.floor(overageSeatsRaw))
    : null;

  return {
    adminUserId,
    sourceType,
    stripeSessionId,
    stripeInvoiceId:
      typeof session?.invoice === 'string'
        ? session.invoice
        : normalizeSessionString(session?.invoice?.id),
    stripeSubscriptionId:
      typeof session?.subscription === 'string'
        ? session.subscription
        : normalizeSessionString(session?.subscription?.id),
    status: normalizeSessionString(session?.status),
    paymentStatus,
    mode: normalizeSessionString(session?.mode),
    currency: session?.currency ? String(session.currency).trim().toUpperCase() : null,
    amountTotal: fromMinorCurrencyToMajor(session?.amount_total),
    amountSubtotal: fromMinorCurrencyToMajor(session?.amount_subtotal),
    expectedMonthlyAmountUsd,
    overageSeats,
    customerEmail:
      normalizeSessionString(session?.customer_details?.email) ||
      normalizeSessionString(session?.customer_email),
    sessionCreatedAt: createdAtDate,
    paidAt: paidAtDate,
  };
};

const buildPaidInvoicesWhere = () => ({
  OR: [
    { paymentStatus: 'paid' },
    { paymentStatus: 'no_payment_required' },
  ],
});

const isPrismaTableMissingError = (error) => {
  return error?.code === 'P2021' || error?.code === 'P2022';
};

const ensureAdminOnly = (req, res) => {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Apenas ADMIN pode acessar a aba financeira.',
    });
    return false;
  }

  return true;
};

const syncInvoicesForAdmin = async ({
  adminUserId,
  stripeLookbackDays,
  stripeMaxPages,
  stripePerPage,
}) => {
  const createdGte = Math.floor(Date.now() / 1000) - stripeLookbackDays * 24 * 60 * 60;

  const stripeResult = await listAdminCheckoutSessions({
    adminUserId,
    createdGte,
    maxPages: stripeMaxPages,
    perPage: stripePerPage,
  });

  if (!stripeResult.ok) {
    return {
      stripeConfigured: false,
      stripeReason: stripeResult.reason || 'STRIPE_NOT_CONFIGURED',
      sessionsScanned: 0,
      invoicesUpserted: 0,
    };
  }

  const sessions = Array.isArray(stripeResult.sessions) ? stripeResult.sessions : [];
  let invoicesUpserted = 0;

  for (const session of sessions) {
    const invoiceData = buildInvoiceDataFromStripeSession({ adminUserId, session });
    if (!invoiceData) continue;

    await prisma.adminBillingInvoice.upsert({
      where: {
        stripeSessionId: invoiceData.stripeSessionId,
      },
      create: invoiceData,
      update: {
        ...invoiceData,
        syncedAt: new Date(),
      },
    });

    invoicesUpserted += 1;
  }

  return {
    stripeConfigured: true,
    stripeReason: null,
    sessionsScanned: sessions.length,
    invoicesUpserted,
  };
};

const getMyFinanceOverview = async (req, res) => {
  try {
    if (!ensureAdminOnly(req, res)) return;

    const admin = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        role: true,
        adminPlanStatus: true,
        adminPlanLinkedAt: true,
        adminSeatLimit: true,
        adminExtraSeatPrice: true,
        adminPlan: {
          select: {
            id: true,
            code: true,
            name: true,
            monthlyPrice: true,
            isActive: true,
          },
        },
      },
    });

    if (!admin || admin.role !== 'ADMIN') {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Conta ADMIN nao encontrada.',
      });
    }

    const occupiedSeats = await prisma.user.count({
      where: {
        organizationAdminId: admin.id,
        role: { in: TEAM_MEMBER_ROLES },
        isActive: true,
      },
    });

    const seatSnapshot = buildPersistedAdminSeatSnapshot({
      planCode: admin.adminPlan?.code,
      seatLimit: admin.adminSeatLimit,
      occupiedSeats,
    });

    const latestBasePlanInvoice = await prisma.adminBillingInvoice.findFirst({
      where: {
        adminUserId: admin.id,
        sourceType: FINANCE_SOURCE_TYPES.BASE_PLAN,
        stripeSubscriptionId: { not: null },
        ...buildPaidInvoicesWhere(),
      },
      orderBy: [{ paidAt: 'desc' }, { sessionCreatedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        stripeSubscriptionId: true,
        paidAt: true,
      },
    });

    let nextBillingAt = null;
    let subscriptionStatus = null;
    let stripeReason = process.env.STRIPE_SECRET_KEY ? null : 'STRIPE_NOT_CONFIGURED';

    if (latestBasePlanInvoice?.stripeSubscriptionId) {
      const subscriptionResult = await getSubscriptionSnapshot({
        subscriptionId: latestBasePlanInvoice.stripeSubscriptionId,
      });

      if (subscriptionResult.ok) {
        nextBillingAt = subscriptionResult.currentPeriodEnd;
        subscriptionStatus = subscriptionResult.status;
        stripeReason = null;
      } else if (stripeReason === null) {
        stripeReason = subscriptionResult.reason || 'STRIPE_SUBSCRIPTION_LOOKUP_FAILED';
      }
    }

    if (!nextBillingAt && latestBasePlanInvoice?.paidAt) {
      const fallbackDate = new Date(latestBasePlanInvoice.paidAt);
      fallbackDate.setUTCMonth(fallbackDate.getUTCMonth() + 1);
      nextBillingAt = fallbackDate.toISOString();
    }

    return res.json({
      generatedAt: new Date().toISOString(),
      stripe: {
        configured: Boolean(process.env.STRIPE_SECRET_KEY),
        reason: stripeReason,
      },
      plan: {
        id: admin.adminPlan?.id || null,
        code: admin.adminPlan?.code || null,
        name: admin.adminPlan?.name || null,
        status: admin.adminPlanStatus,
        linkedAt: admin.adminPlanLinkedAt,
        monthlyPriceUsd: admin.adminPlan
          ? Number(toNumber(admin.adminPlan.monthlyPrice, 0).toFixed(2))
          : 0,
        isCatalogActive: admin.adminPlan?.isActive ?? false,
        nextBillingAt,
        subscriptionStatus,
      },
      billing: {
        seatLimit: seatSnapshot.seatLimit,
        activeSeats: seatSnapshot.activeSeats,
        contractedExtraSeats: seatSnapshot.contractedExtraSeats,
        availableSeats: seatSnapshot.availableSeats,
        overageSeats: seatSnapshot.overageSeats,
        extraSeatPriceUsd: Number(
          toNumber(admin.adminExtraSeatPrice, EXTRA_ADMIN_SEAT_MONTHLY_USD).toFixed(2)
        ),
      },
      actions: {
        changePlanPath: '/app/escolher-plano',
        buySeatsPath: '/app/admin/comprar-assentos',
      },
    });
  } catch (error) {
    console.error('❌ Erro ao carregar visão financeira do ADMIN:', error);

    if (isPrismaTableMissingError(error)) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Tabela de faturas nao encontrada. Execute as migrations de banco.',
      });
    }

    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao carregar visão financeira da conta ADMIN',
    });
  }
};

const syncMyFinanceInvoices = async (req, res) => {
  try {
    if (!ensureAdminOnly(req, res)) return;

    const stripeLookbackDays = Math.min(3650, toPositiveInteger(req.query.stripeLookbackDays, 365));
    const stripeMaxPages = Math.min(20, toPositiveInteger(req.query.stripeMaxPages, 6));
    const stripePerPage = Math.min(100, toPositiveInteger(req.query.stripePerPage, 100));

    const syncResult = await syncInvoicesForAdmin({
      adminUserId: req.user.id,
      stripeLookbackDays,
      stripeMaxPages,
      stripePerPage,
    });

    const totalPersistedInvoices = await prisma.adminBillingInvoice.count({
      where: { adminUserId: req.user.id },
    });

    return res.json({
      message: syncResult.stripeConfigured
        ? 'Faturas sincronizadas com sucesso.'
        : 'Stripe nao configurado; exibindo apenas dados ja persistidos no banco.',
      stripe: {
        configured: syncResult.stripeConfigured,
        reason: syncResult.stripeReason,
        sessionsScanned: syncResult.sessionsScanned,
        lookbackDays: stripeLookbackDays,
      },
      sync: {
        invoicesUpserted: syncResult.invoicesUpserted,
        totalPersistedInvoices,
      },
    });
  } catch (error) {
    console.error('❌ Erro ao sincronizar faturas do ADMIN:', error);

    if (isPrismaTableMissingError(error)) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Tabela de faturas nao encontrada. Execute as migrations de banco.',
      });
    }

    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao sincronizar faturas da conta ADMIN',
    });
  }
};

const listMyFinanceInvoices = async (req, res) => {
  try {
    if (!ensureAdminOnly(req, res)) return;

    const page = Math.max(1, toPositiveInteger(req.query.page, 1));
    const limit = Math.min(100, toPositiveInteger(req.query.limit, 20));
    const statusFilter = String(req.query.status || 'paid').trim().toLowerCase();

    if (!['paid', 'all'].includes(statusFilter)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'status invalido. Valores aceitos: paid, all.',
      });
    }

    const whereClause = {
      adminUserId: req.user.id,
      ...(statusFilter === 'paid' ? buildPaidInvoicesWhere() : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.adminBillingInvoice.count({ where: whereClause }),
      prisma.adminBillingInvoice.findMany({
        where: whereClause,
        orderBy: [{ paidAt: 'desc' }, { sessionCreatedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          sourceType: true,
          stripeSessionId: true,
          stripeInvoiceId: true,
          stripeSubscriptionId: true,
          status: true,
          paymentStatus: true,
          mode: true,
          currency: true,
          amountTotal: true,
          amountSubtotal: true,
          expectedMonthlyAmountUsd: true,
          overageSeats: true,
          customerEmail: true,
          sessionCreatedAt: true,
          paidAt: true,
          syncedAt: true,
          createdAt: true,
        },
      }),
    ]);

    const invoices = rows.map((row) => ({
      id: row.id,
      sourceType: row.sourceType,
      stripeSessionId: row.stripeSessionId,
      stripeInvoiceId: row.stripeInvoiceId,
      stripeSubscriptionId: row.stripeSubscriptionId,
      status: row.status,
      paymentStatus: row.paymentStatus,
      mode: row.mode,
      currency: row.currency,
      amountTotal: row.amountTotal === null ? null : Number(toNumber(row.amountTotal, 0).toFixed(2)),
      amountSubtotal:
        row.amountSubtotal === null ? null : Number(toNumber(row.amountSubtotal, 0).toFixed(2)),
      expectedMonthlyAmountUsd:
        row.expectedMonthlyAmountUsd === null
          ? null
          : Number(toNumber(row.expectedMonthlyAmountUsd, 0).toFixed(2)),
      overageSeats: row.overageSeats,
      customerEmail: row.customerEmail,
      sessionCreatedAt: row.sessionCreatedAt,
      paidAt: row.paidAt,
      syncedAt: row.syncedAt,
      createdAt: row.createdAt,
    }));

    return res.json({
      invoices,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error('❌ Erro ao listar faturas do ADMIN:', error);

    if (isPrismaTableMissingError(error)) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Tabela de faturas nao encontrada. Execute as migrations de banco.',
      });
    }

    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao listar faturas da conta ADMIN',
    });
  }
};

module.exports = {
  getMyFinanceOverview,
  syncMyFinanceInvoices,
  listMyFinanceInvoices,
};
