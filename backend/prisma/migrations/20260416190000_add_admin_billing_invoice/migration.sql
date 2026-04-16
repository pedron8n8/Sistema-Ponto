CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
	user_table_name TEXT;
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'users'
	) THEN
		user_table_name := 'users';
	ELSIF EXISTS (
		SELECT 1
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'User'
	) THEN
		user_table_name := 'User';
	ELSE
		RAISE EXCEPTION 'Neither "users" nor "User" table exists in schema public.';
	END IF;

	EXECUTE format(
		'CREATE TABLE IF NOT EXISTS "AdminBillingInvoice" (
			"id" UUID NOT NULL DEFAULT gen_random_uuid(),
			"adminUserId" TEXT NOT NULL,
			"sourceType" TEXT NOT NULL,
			"stripeSessionId" TEXT NOT NULL,
			"stripeInvoiceId" TEXT,
			"stripeSubscriptionId" TEXT,
			"status" TEXT,
			"paymentStatus" TEXT,
			"mode" TEXT,
			"currency" TEXT,
			"amountTotal" DECIMAL(10,2),
			"amountSubtotal" DECIMAL(10,2),
			"expectedMonthlyAmountUsd" DECIMAL(10,2),
			"overageSeats" INTEGER,
			"customerEmail" TEXT,
			"sessionCreatedAt" TIMESTAMP(3),
			"paidAt" TIMESTAMP(3),
			"syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
			"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
			"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
			CONSTRAINT "AdminBillingInvoice_pkey" PRIMARY KEY ("id"),
			CONSTRAINT "AdminBillingInvoice_adminUserId_fkey"
				FOREIGN KEY ("adminUserId") REFERENCES %I("id") ON DELETE RESTRICT ON UPDATE CASCADE
		)',
		user_table_name
	);
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "AdminBillingInvoice_stripeSessionId_key"
	ON "AdminBillingInvoice" ("stripeSessionId");

CREATE INDEX IF NOT EXISTS "AdminBillingInvoice_adminUserId_idx"
	ON "AdminBillingInvoice" ("adminUserId");

CREATE INDEX IF NOT EXISTS "AdminBillingInvoice_adminUserId_paymentStatus_idx"
	ON "AdminBillingInvoice" ("adminUserId", "paymentStatus");

CREATE INDEX IF NOT EXISTS "AdminBillingInvoice_adminUserId_sourceType_idx"
	ON "AdminBillingInvoice" ("adminUserId", "sourceType");

CREATE INDEX IF NOT EXISTS "AdminBillingInvoice_adminUserId_paidAt_idx"
	ON "AdminBillingInvoice" ("adminUserId", "paidAt");

CREATE INDEX IF NOT EXISTS "AdminBillingInvoice_stripeInvoiceId_idx"
	ON "AdminBillingInvoice" ("stripeInvoiceId");

CREATE INDEX IF NOT EXISTS "AdminBillingInvoice_stripeSubscriptionId_idx"
	ON "AdminBillingInvoice" ("stripeSubscriptionId");
