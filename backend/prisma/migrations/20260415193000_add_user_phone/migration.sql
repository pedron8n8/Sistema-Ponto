-- Add optional phone field to user profile
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "phone" TEXT;
