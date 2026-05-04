const Stripe = require('stripe');

const getStripeClient = () => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  return new Stripe(secretKey);
};

const toPositiveInteger = (value, fallback = 1) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : fallback;
};

const toCurrencyAmount = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Number(parsed.toFixed(2));
};

const parsedExtraAdminSeatMonthlyUsd = Number(process.env.EXTRA_ADMIN_SEAT_MONTHLY_USD);
const EXTRA_ADMIN_SEAT_MONTHLY_USD = Number(
  (
    Number.isFinite(parsedExtraAdminSeatMonthlyUsd) && parsedExtraAdminSeatMonthlyUsd >= 0
      ? parsedExtraAdminSeatMonthlyUsd
      : 7.5
  ).toFixed(2)
);

const normalizePlanCode = (value) => String(value || '').trim().toUpperCase();

const resolveBasePlanPriceId = (planCode) => {
  const normalized = normalizePlanCode(planCode);
  const fallbackPriceId = process.env.STRIPE_PLAN_DEFAULT_PRICE_ID || null;

  const priceMap = {
    STARTER: process.env.STRIPE_PLAN_STARTER_PRICE_ID || fallbackPriceId,
    GROWTH: process.env.STRIPE_PLAN_GROWTH_PRICE_ID || fallbackPriceId,
    PRO: process.env.STRIPE_PLAN_PRO_PRICE_ID || fallbackPriceId,
  };

  return {
    planCode: normalized,
    priceId: priceMap[normalized] || null,
  };
};

const buildBasePlanLineItem = ({
  resolvedPlan,
  planName,
  planMonthlyPriceUsd,
}) => {
  const baseLineItem = {
    // Plano base sempre cobra valor fixo mensal, independente do limite inicial de cadeiras.
    quantity: 1,
  };

  if (resolvedPlan.priceId) {
    return {
      ...baseLineItem,
      price: resolvedPlan.priceId,
    };
  }

  const unitAmountInCents = Math.max(50, Math.round(toCurrencyAmount(planMonthlyPriceUsd, 0) * 100));

  return {
    ...baseLineItem,
    price_data: {
      currency: 'usd',
      unit_amount: unitAmountInCents,
      recurring: {
        interval: 'month',
      },
      product_data: {
        name: `Plano ${String(planName || resolvedPlan.planCode || 'SystemaPonto').trim()}`,
      },
    },
  };
};

const createBasePlanCheckoutSession = async ({
  adminUserId,
  adminEmail,
  planCode,
  planName,
  planMonthlyPriceUsd,
  seatLimit,
}) => {
  const stripe = getStripeClient();
  if (!stripe) {
    return {
      ok: false,
      reason: 'STRIPE_NOT_CONFIGURED',
      checkoutUrl: null,
    };
  }

  const resolvedPlan = resolveBasePlanPriceId(planCode);
  const safeSeatLimit = toPositiveInteger(seatLimit, 1);
  const frontendUrl = process.env.FRONTEND_URL || 'https://app.omnipunt.com';
  const successUrl =
    process.env.STRIPE_PLAN_SELECTION_SUCCESS_URL ||
    `${frontendUrl}/app/escolher-plano?status=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl =
    process.env.STRIPE_PLAN_SELECTION_CANCEL_URL ||
    `${frontendUrl}/app/escolher-plano?status=cancel`;

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [
      buildBasePlanLineItem({
        resolvedPlan,
        planName,
        planMonthlyPriceUsd,
      }),
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: adminEmail || undefined,
    metadata: {
      type: 'base_admin_plan',
      adminUserId: String(adminUserId || ''),
      planCode: resolvedPlan.planCode,
      requestedSeatLimit: String(safeSeatLimit),
      planName: String(planName || ''),
    },
    allow_promotion_codes: true,
  });

  return {
    ok: true,
    reason: null,
    checkoutUrl: session.url,
    sessionId: session.id,
    planCode: resolvedPlan.planCode,
    seatLimit: safeSeatLimit,
  };
};

const verifyBasePlanCheckoutSession = async ({
  sessionId,
  adminUserId,
}) => {
  const stripe = getStripeClient();
  if (!stripe) {
    return {
      ok: false,
      reason: 'STRIPE_NOT_CONFIGURED',
    };
  }

  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) {
    return {
      ok: false,
      reason: 'SESSION_ID_REQUIRED',
    };
  }

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(normalizedSessionId);
  } catch (error) {
    return {
      ok: false,
      reason: 'SESSION_NOT_FOUND',
      details: error.message,
    };
  }

  const metadata = session?.metadata || {};
  if (metadata.type !== 'base_admin_plan') {
    return {
      ok: false,
      reason: 'INVALID_SESSION_TYPE',
    };
  }

  if (String(metadata.adminUserId || '') !== String(adminUserId || '')) {
    return {
      ok: false,
      reason: 'ADMIN_MISMATCH',
    };
  }

  const status = String(session?.status || '').toLowerCase();
  const paymentStatus = String(session?.payment_status || '').toLowerCase();
  const isPaidSession =
    status === 'complete' &&
    (paymentStatus === 'paid' || paymentStatus === 'no_payment_required');

  if (!isPaidSession) {
    return {
      ok: false,
      reason: 'SESSION_NOT_PAID',
      status,
      paymentStatus,
    };
  }

  const purchasedSeatLimit = toPositiveInteger(metadata.requestedSeatLimit, 1);

  return {
    ok: true,
    reason: null,
    sessionId: normalizedSessionId,
    planCode: normalizePlanCode(metadata.planCode),
    seatLimit: purchasedSeatLimit,
    status,
    paymentStatus,
  };
};

const listAdditionalSeatsCheckoutSessions = async ({
  perPage = 100,
  maxPages = 5,
  createdGte,
} = {}) => {
  const stripe = getStripeClient();

  if (!stripe) {
    return {
      ok: false,
      reason: 'STRIPE_NOT_CONFIGURED',
      sessions: [],
    };
  }

  const safePerPage = Math.min(100, toPositiveInteger(perPage, 100));
  const safeMaxPages = toPositiveInteger(maxPages, 5);
  const hasCreatedGte = Number.isFinite(Number(createdGte)) && Number(createdGte) > 0;

  let startingAfter;
  const sessions = [];

  for (let page = 0; page < safeMaxPages; page += 1) {
    const listParams = {
      limit: safePerPage,
      ...(hasCreatedGte && { created: { gte: Math.floor(Number(createdGte)) } }),
      ...(startingAfter && { starting_after: startingAfter }),
    };

    const response = await stripe.checkout.sessions.list(listParams);
    const pageItems = Array.isArray(response?.data) ? response.data : [];

    const relevantItems = pageItems.filter(
      (session) => session?.metadata?.type === 'additional_admin_seats'
    );
    sessions.push(...relevantItems);

    if (!response?.has_more || pageItems.length === 0) {
      break;
    }

    startingAfter = pageItems[pageItems.length - 1]?.id;
    if (!startingAfter) {
      break;
    }
  }

  return {
    ok: true,
    reason: null,
    sessions,
  };
};

const DEFAULT_ADMIN_SESSION_TYPES = ['base_admin_plan', 'additional_admin_seats'];

const normalizeSessionTypes = (sessionTypes) => {
  const source = Array.isArray(sessionTypes) ? sessionTypes : DEFAULT_ADMIN_SESSION_TYPES;

  return source
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
};

const listAdminCheckoutSessions = async ({
  adminUserId,
  perPage = 100,
  maxPages = 5,
  createdGte,
  sessionTypes = DEFAULT_ADMIN_SESSION_TYPES,
} = {}) => {
  const stripe = getStripeClient();

  if (!stripe) {
    return {
      ok: false,
      reason: 'STRIPE_NOT_CONFIGURED',
      sessions: [],
    };
  }

  const normalizedAdminUserId = String(adminUserId || '').trim();
  if (!normalizedAdminUserId) {
    return {
      ok: false,
      reason: 'ADMIN_USER_ID_REQUIRED',
      sessions: [],
    };
  }

  const normalizedSessionTypes = normalizeSessionTypes(sessionTypes);
  const safePerPage = Math.min(100, toPositiveInteger(perPage, 100));
  const safeMaxPages = toPositiveInteger(maxPages, 5);
  const hasCreatedGte = Number.isFinite(Number(createdGte)) && Number(createdGte) > 0;

  let startingAfter;
  const sessions = [];

  for (let page = 0; page < safeMaxPages; page += 1) {
    const listParams = {
      limit: safePerPage,
      ...(hasCreatedGte && { created: { gte: Math.floor(Number(createdGte)) } }),
      ...(startingAfter && { starting_after: startingAfter }),
    };

    const response = await stripe.checkout.sessions.list(listParams);
    const pageItems = Array.isArray(response?.data) ? response.data : [];

    const relevantItems = pageItems.filter((session) => {
      const metadata = session?.metadata || {};
      const sessionAdminUserId = String(metadata.adminUserId || '').trim();
      const sessionType = String(metadata.type || '').trim().toLowerCase();

      if (sessionAdminUserId !== normalizedAdminUserId) {
        return false;
      }

      if (normalizedSessionTypes.length === 0) {
        return true;
      }

      return normalizedSessionTypes.includes(sessionType);
    });

    sessions.push(...relevantItems);

    if (!response?.has_more || pageItems.length === 0) {
      break;
    }

    startingAfter = pageItems[pageItems.length - 1]?.id;
    if (!startingAfter) {
      break;
    }
  }

  return {
    ok: true,
    reason: null,
    sessions,
  };
};

const toIsoFromUnixSeconds = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return new Date(parsed * 1000).toISOString();
};

const getSubscriptionSnapshot = async ({ subscriptionId } = {}) => {
  const stripe = getStripeClient();

  if (!stripe) {
    return {
      ok: false,
      reason: 'STRIPE_NOT_CONFIGURED',
    };
  }

  const normalizedSubscriptionId = String(subscriptionId || '').trim();
  if (!normalizedSubscriptionId) {
    return {
      ok: false,
      reason: 'SUBSCRIPTION_ID_REQUIRED',
    };
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(normalizedSubscriptionId);

    return {
      ok: true,
      reason: null,
      id: subscription.id,
      status: subscription.status || null,
      currentPeriodStart: toIsoFromUnixSeconds(subscription.current_period_start),
      currentPeriodEnd: toIsoFromUnixSeconds(subscription.current_period_end),
      cancelAt: toIsoFromUnixSeconds(subscription.cancel_at),
      canceledAt: toIsoFromUnixSeconds(subscription.canceled_at),
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'SUBSCRIPTION_NOT_FOUND',
      details: error?.message || null,
    };
  }
};

const createAdditionalSeatsCheckoutSession = async ({
  adminUserId,
  adminEmail,
  overageSeats,
  amountDue,
}) => {
  const stripe = getStripeClient();
  const priceId = process.env.STRIPE_ADDITIONAL_SEAT_PRICE_ID;

  if (!stripe || !priceId) {
    return {
      ok: false,
      reason: 'STRIPE_NOT_CONFIGURED',
      checkoutUrl: null,
    };
  }

  const quantity = toPositiveInteger(overageSeats, 1);
  const safeAmountDue = toCurrencyAmount(amountDue, quantity * EXTRA_ADMIN_SEAT_MONTHLY_USD);
  const frontendUrl = process.env.FRONTEND_URL || 'https://app.omnipunt.com';
  const successUrl =
    process.env.STRIPE_ADDITIONAL_SEAT_SUCCESS_URL ||
    `${frontendUrl}/app/admin/obrigado?status=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl =
    process.env.STRIPE_ADDITIONAL_SEAT_CANCEL_URL ||
    `${frontendUrl}/app/admin/billing-result?status=error&reason=checkout_cancelled`;

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [
      {
        price: priceId,
        quantity,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: adminEmail || undefined,
    metadata: {
      type: 'additional_admin_seats',
      adminUserId: String(adminUserId || ''),
      overageSeats: String(quantity),
      expectedMonthlyAmountUsd: String(safeAmountDue),
    },
    allow_promotion_codes: true,
  });

  return {
    ok: true,
    checkoutUrl: session.url,
    sessionId: session.id,
    quantity,
  };
};

const verifyAdditionalSeatsCheckoutSession = async ({
  sessionId,
  adminUserId,
}) => {
  const stripe = getStripeClient();
  if (!stripe) {
    return {
      ok: false,
      reason: 'STRIPE_NOT_CONFIGURED',
    };
  }

  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) {
    return {
      ok: false,
      reason: 'SESSION_ID_REQUIRED',
    };
  }

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(normalizedSessionId);
  } catch (error) {
    return {
      ok: false,
      reason: 'SESSION_NOT_FOUND',
      details: error.message,
    };
  }

  const metadata = session?.metadata || {};
  if (metadata.type !== 'additional_admin_seats') {
    return {
      ok: false,
      reason: 'INVALID_SESSION_TYPE',
    };
  }

  if (String(metadata.adminUserId || '') !== String(adminUserId || '')) {
    return {
      ok: false,
      reason: 'ADMIN_MISMATCH',
    };
  }

  const status = String(session?.status || '').toLowerCase();
  const paymentStatus = String(session?.payment_status || '').toLowerCase();
  const isPaidSession =
    status === 'complete' &&
    (paymentStatus === 'paid' || paymentStatus === 'no_payment_required');

  if (!isPaidSession) {
    return {
      ok: false,
      reason: 'SESSION_NOT_PAID',
      status,
      paymentStatus,
    };
  }

  const contractedExtraSeats = toPositiveInteger(metadata.overageSeats, 1);

  return {
    ok: true,
    reason: null,
    sessionId: normalizedSessionId,
    contractedExtraSeats,
    status,
    paymentStatus,
  };
};

module.exports = {
  createAdditionalSeatsCheckoutSession,
  verifyAdditionalSeatsCheckoutSession,
  listAdditionalSeatsCheckoutSessions,
  listAdminCheckoutSessions,
  getSubscriptionSnapshot,
  createBasePlanCheckoutSession,
  verifyBasePlanCheckoutSession,
};
