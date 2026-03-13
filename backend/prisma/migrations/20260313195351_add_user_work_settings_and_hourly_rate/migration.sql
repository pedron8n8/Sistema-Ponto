-- AlterTable
ALTER TABLE "User" ADD COLUMN     "hourlyRate" DECIMAL(10,2),
ADD COLUMN     "workdayEndTime" TEXT,
ADD COLUMN     "workdayStartTime" TEXT;
