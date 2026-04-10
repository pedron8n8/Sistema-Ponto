-- Admin plans and stricter user-admin ownership rules

DO $$
BEGIN
  CREATE TYPE "AdminPlanStatus" AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "AdminPlan" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "monthlyPrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdminPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AdminPlan_code_key" ON "AdminPlan"("code");

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "adminPlanId" TEXT,
  ADD COLUMN IF NOT EXISTS "adminPlanStatus" "AdminPlanStatus" NOT NULL DEFAULT 'INACTIVE',
  ADD COLUMN IF NOT EXISTS "adminPlanLinkedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "User_adminPlanId_idx" ON "User"("adminPlanId");

DO $$
BEGIN
  ALTER TABLE "User"
    ADD CONSTRAINT "User_adminPlanId_fkey"
    FOREIGN KEY ("adminPlanId") REFERENCES "AdminPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO "AdminPlan" ("id", "code", "name", "description", "monthlyPrice", "isActive", "createdAt", "updatedAt")
VALUES ('plan_base', 'BASE', 'Plano Base', 'Plano padrão para administradores', 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name",
    "description" = EXCLUDED."description",
    "monthlyPrice" = EXCLUDED."monthlyPrice",
    "isActive" = true,
    "updatedAt" = CURRENT_TIMESTAMP;

-- Admin deve ser o proprio owner de organização.
UPDATE "User"
SET "organizationAdminId" = "id"
WHERE "role" = 'ADMIN'
  AND "organizationAdminId" IS NULL;

-- Herdar owner admin via supervisor quando possível.
UPDATE "User" AS target
SET "organizationAdminId" = CASE
  WHEN supervisor."role" = 'ADMIN' THEN supervisor."id"
  ELSE supervisor."organizationAdminId"
END
FROM "User" AS supervisor
WHERE target."supervisorId" = supervisor."id"
  AND target."role" <> 'SUPERADMIN'
  AND target."organizationAdminId" IS NULL;

-- Todo ADMIN precisa ter plano vinculado (ativo ou inativo).
UPDATE "User"
SET "adminPlanId" = (SELECT "id" FROM "AdminPlan" WHERE "code" = 'BASE' LIMIT 1),
    "adminPlanStatus" = COALESCE("adminPlanStatus", 'INACTIVE'),
    "adminPlanLinkedAt" = COALESCE("adminPlanLinkedAt", CURRENT_TIMESTAMP)
WHERE "role" = 'ADMIN'
  AND "adminPlanId" IS NULL;

DO $$
BEGIN
  ALTER TABLE "User"
    ADD CONSTRAINT "User_non_superadmin_must_have_admin_link"
    CHECK ("role" = 'SUPERADMIN' OR "organizationAdminId" IS NOT NULL) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "User"
    ADD CONSTRAINT "User_admin_must_self_link_admin_id"
    CHECK ("role" <> 'ADMIN' OR "organizationAdminId" = "id") NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "User"
    ADD CONSTRAINT "User_admin_must_have_plan"
    CHECK ("role" <> 'ADMIN' OR "adminPlanId" IS NOT NULL) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
