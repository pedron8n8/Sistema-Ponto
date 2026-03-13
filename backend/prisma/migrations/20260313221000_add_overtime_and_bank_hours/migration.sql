-- CreateEnum
CREATE TYPE "BankHoursEntryType" AS ENUM ('ACCRUAL', 'ADJUSTMENT', 'EXPIRY');

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "contractDailyMinutes" INTEGER NOT NULL DEFAULT 480,
ADD COLUMN "bankHoursBalanceMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "bankHoursLimitMinutes" INTEGER,
ADD COLUMN "bankHoursExpiryMonths" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN "bankHoursPolicyCode" TEXT;

-- AlterTable
ALTER TABLE "TimeEntry"
ADD COLUMN "workedMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "overtimeMinutes50" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "overtimeMinutes100" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "overtimePercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "bankHoursAccruedMinutes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "BankHoursEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timeEntryId" TEXT,
    "type" "BankHoursEntryType" NOT NULL,
    "minutes" INTEGER NOT NULL,
    "description" TEXT,
    "expiresAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankHoursEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankHoursEntry_userId_idx" ON "BankHoursEntry"("userId");

-- CreateIndex
CREATE INDEX "BankHoursEntry_timeEntryId_idx" ON "BankHoursEntry"("timeEntryId");

-- CreateIndex
CREATE INDEX "BankHoursEntry_type_idx" ON "BankHoursEntry"("type");

-- CreateIndex
CREATE INDEX "BankHoursEntry_expiresAt_idx" ON "BankHoursEntry"("expiresAt");

-- AddForeignKey
ALTER TABLE "BankHoursEntry" ADD CONSTRAINT "BankHoursEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankHoursEntry" ADD CONSTRAINT "BankHoursEntry_timeEntryId_fkey" FOREIGN KEY ("timeEntryId") REFERENCES "TimeEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
