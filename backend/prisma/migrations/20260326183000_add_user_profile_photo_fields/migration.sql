-- Add profile photo storage columns for local user photos
ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "photoPath" TEXT,
ADD COLUMN IF NOT EXISTS "photoUpdatedAt" TIMESTAMP(3);
