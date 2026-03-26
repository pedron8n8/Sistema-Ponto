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
  const safeAmountDue = toCurrencyAmount(amountDue, quantity * 10);
  const successUrl =
    process.env.STRIPE_ADDITIONAL_SEAT_SUCCESS_URL ||
    `${process.env.FRONTEND_URL || 'http://localhost:5173'}/app/admin/billing-result?status=success`;
  const cancelUrl =
    process.env.STRIPE_ADDITIONAL_SEAT_CANCEL_URL ||
    `${process.env.FRONTEND_URL || 'http://localhost:5173'}/app/admin/billing-result?status=cancel`;

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

module.exports = {
  createAdditionalSeatsCheckoutSession,
};
