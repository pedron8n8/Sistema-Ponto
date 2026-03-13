-- CreateEnum
CREATE TYPE "BankHoursPaymentStatus" AS ENUM ('PENDING', 'PAID');

-- AlterTable
ALTER TABLE "BankHoursEntry" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paidById" TEXT,
ADD COLUMN     "paymentNote" TEXT,
ADD COLUMN     "paymentStatus" "BankHoursPaymentStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "BankHoursEntry_paymentStatus_idx" ON "BankHoursEntry"("paymentStatus");
