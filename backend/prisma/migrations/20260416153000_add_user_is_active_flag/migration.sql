DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'users'
	) THEN
		ALTER TABLE "users"
			ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT TRUE;

		CREATE INDEX IF NOT EXISTS "users_isActive_idx" ON "users"("isActive");
	ELSIF EXISTS (
		SELECT 1
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'User'
	) THEN
		ALTER TABLE "User"
			ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT TRUE;

		CREATE INDEX IF NOT EXISTS "User_isActive_idx" ON "User"("isActive");
	ELSE
		RAISE EXCEPTION 'Neither "users" nor "User" table exists in schema public.';
	END IF;
END $$;
