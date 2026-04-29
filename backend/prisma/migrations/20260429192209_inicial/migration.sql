-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPERADMIN', 'ADMIN', 'HR', 'SUPERVISOR', 'MEMBER');

-- CreateEnum
CREATE TYPE "AdminPlanStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BankHoursEntryType" AS ENUM ('ACCRUAL', 'ADJUSTMENT', 'EXPIRY');

-- CreateEnum
CREATE TYPE "BankHoursPaymentStatus" AS ENUM ('PENDING', 'PAID');

-- CreateEnum
CREATE TYPE "VacationStatus" AS ENUM ('REQUESTED', 'SUPERVISOR_APPROVED', 'SUPERVISOR_REJECTED', 'HR_CONFIRMED', 'HR_REJECTED', 'CANCELED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "facialEmbedding" JSONB,
    "facialEmbeddingUpdatedAt" TIMESTAMP(3),
    "facialThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.45,
    "pinHash" TEXT,
    "pinSalt" TEXT,
    "pinUpdatedAt" TIMESTAMP(3),
    "pinFailedAttempts" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" TIMESTAMP(3),
    "photoPath" TEXT,
    "photoUpdatedAt" TIMESTAMP(3),
    "contractDailyMinutes" INTEGER NOT NULL DEFAULT 480,
    "workdayStartTime" TEXT,
    "workdayEndTime" TEXT,
    "hourlyRate" DECIMAL(10,2),
    "timeZone" TEXT NOT NULL DEFAULT 'America/New_York',
    "bankHoursBalanceMinutes" INTEGER NOT NULL DEFAULT 0,
    "bankHoursLimitMinutes" INTEGER,
    "bankHoursExpiryMonths" INTEGER NOT NULL DEFAULT 6,
    "bankHoursPolicyCode" TEXT,
    "supervisorId" TEXT,
    "organizationAdminId" TEXT,
    "adminSeatLimit" INTEGER,
    "adminExtraSeatPrice" DECIMAL(10,2),
    "adminActiveSeats" INTEGER NOT NULL DEFAULT 0,
    "adminExtraSeatsContracted" INTEGER NOT NULL DEFAULT 0,
    "adminPlanId" TEXT,
    "adminPlanStatus" "AdminPlanStatus" NOT NULL DEFAULT 'INACTIVE',
    "adminPlanLinkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "monthlyPrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminBillingInvoice" (
    "id" TEXT NOT NULL,
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminBillingInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clockIn" TIMESTAMP(3) NOT NULL,
    "clockOut" TIMESTAMP(3),
    "notes" TEXT,
    "ipAddress" TEXT,
    "location" JSONB,
    "device" TEXT,
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeMinutes50" INTEGER NOT NULL DEFAULT 0,
    "overtimeMinutes100" INTEGER NOT NULL DEFAULT 0,
    "overtimePercent" INTEGER NOT NULL DEFAULT 0,
    "bankHoursAccruedMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" "EntryStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankHoursEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timeEntryId" TEXT,
    "type" "BankHoursEntryType" NOT NULL,
    "paymentStatus" "BankHoursPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "paymentNote" TEXT,
    "minutes" INTEGER NOT NULL,
    "description" TEXT,
    "expiresAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankHoursEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalLog" (
    "id" TEXT NOT NULL,
    "timeEntryId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "comment" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VacationRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "supervisorId" TEXT,
    "hrReviewerId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "status" "VacationStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supervisorReviewedAt" TIMESTAMP(3),
    "hrReviewedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VacationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VacationApprovalLog" (
    "id" TEXT NOT NULL,
    "vacationRequestId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "comment" TEXT,
    "fromStatus" "VacationStatus",
    "toStatus" "VacationStatus",
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VacationApprovalLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_supervisorId_idx" ON "User"("supervisorId");

-- CreateIndex
CREATE INDEX "User_organizationAdminId_idx" ON "User"("organizationAdminId");

-- CreateIndex
CREATE INDEX "User_adminPlanId_idx" ON "User"("adminPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminPlan_code_key" ON "AdminPlan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AdminBillingInvoice_stripeSessionId_key" ON "AdminBillingInvoice"("stripeSessionId");

-- CreateIndex
CREATE INDEX "AdminBillingInvoice_adminUserId_idx" ON "AdminBillingInvoice"("adminUserId");

-- CreateIndex
CREATE INDEX "AdminBillingInvoice_adminUserId_paymentStatus_idx" ON "AdminBillingInvoice"("adminUserId", "paymentStatus");

-- CreateIndex
CREATE INDEX "AdminBillingInvoice_adminUserId_sourceType_idx" ON "AdminBillingInvoice"("adminUserId", "sourceType");

-- CreateIndex
CREATE INDEX "AdminBillingInvoice_adminUserId_paidAt_idx" ON "AdminBillingInvoice"("adminUserId", "paidAt");

-- CreateIndex
CREATE INDEX "AdminBillingInvoice_stripeInvoiceId_idx" ON "AdminBillingInvoice"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "AdminBillingInvoice_stripeSubscriptionId_idx" ON "AdminBillingInvoice"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "TimeEntry_userId_idx" ON "TimeEntry"("userId");

-- CreateIndex
CREATE INDEX "TimeEntry_status_idx" ON "TimeEntry"("status");

-- CreateIndex
CREATE INDEX "TimeEntry_clockIn_idx" ON "TimeEntry"("clockIn");

-- CreateIndex
CREATE INDEX "TimeEntry_userId_status_idx" ON "TimeEntry"("userId", "status");

-- CreateIndex
CREATE INDEX "TimeEntry_userId_clockIn_idx" ON "TimeEntry"("userId", "clockIn");

-- CreateIndex
CREATE INDEX "BankHoursEntry_userId_idx" ON "BankHoursEntry"("userId");

-- CreateIndex
CREATE INDEX "BankHoursEntry_timeEntryId_idx" ON "BankHoursEntry"("timeEntryId");

-- CreateIndex
CREATE INDEX "BankHoursEntry_type_idx" ON "BankHoursEntry"("type");

-- CreateIndex
CREATE INDEX "BankHoursEntry_expiresAt_idx" ON "BankHoursEntry"("expiresAt");

-- CreateIndex
CREATE INDEX "BankHoursEntry_paymentStatus_idx" ON "BankHoursEntry"("paymentStatus");

-- CreateIndex
CREATE INDEX "ApprovalLog_timeEntryId_idx" ON "ApprovalLog"("timeEntryId");

-- CreateIndex
CREATE INDEX "ApprovalLog_reviewerId_idx" ON "ApprovalLog"("reviewerId");

-- CreateIndex
CREATE INDEX "ApprovalLog_timestamp_idx" ON "ApprovalLog"("timestamp");

-- CreateIndex
CREATE INDEX "VacationRequest_userId_idx" ON "VacationRequest"("userId");

-- CreateIndex
CREATE INDEX "VacationRequest_supervisorId_idx" ON "VacationRequest"("supervisorId");

-- CreateIndex
CREATE INDEX "VacationRequest_status_idx" ON "VacationRequest"("status");

-- CreateIndex
CREATE INDEX "VacationRequest_startDate_idx" ON "VacationRequest"("startDate");

-- CreateIndex
CREATE INDEX "VacationRequest_endDate_idx" ON "VacationRequest"("endDate");

-- CreateIndex
CREATE INDEX "VacationApprovalLog_vacationRequestId_idx" ON "VacationApprovalLog"("vacationRequestId");

-- CreateIndex
CREATE INDEX "VacationApprovalLog_actorId_idx" ON "VacationApprovalLog"("actorId");

-- CreateIndex
CREATE INDEX "VacationApprovalLog_timestamp_idx" ON "VacationApprovalLog"("timestamp");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationAdminId_fkey" FOREIGN KEY ("organizationAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_adminPlanId_fkey" FOREIGN KEY ("adminPlanId") REFERENCES "AdminPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminBillingInvoice" ADD CONSTRAINT "AdminBillingInvoice_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankHoursEntry" ADD CONSTRAINT "BankHoursEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankHoursEntry" ADD CONSTRAINT "BankHoursEntry_timeEntryId_fkey" FOREIGN KEY ("timeEntryId") REFERENCES "TimeEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalLog" ADD CONSTRAINT "ApprovalLog_timeEntryId_fkey" FOREIGN KEY ("timeEntryId") REFERENCES "TimeEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalLog" ADD CONSTRAINT "ApprovalLog_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacationRequest" ADD CONSTRAINT "VacationRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacationRequest" ADD CONSTRAINT "VacationRequest_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacationRequest" ADD CONSTRAINT "VacationRequest_hrReviewerId_fkey" FOREIGN KEY ("hrReviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacationApprovalLog" ADD CONSTRAINT "VacationApprovalLog_vacationRequestId_fkey" FOREIGN KEY ("vacationRequestId") REFERENCES "VacationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacationApprovalLog" ADD CONSTRAINT "VacationApprovalLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
