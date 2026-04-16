DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'users'
	) THEN
		ALTER TABLE "users"
			ADD COLUMN IF NOT EXISTS "adminActiveSeats" INTEGER NOT NULL DEFAULT 0,
			ADD COLUMN IF NOT EXISTS "adminExtraSeatsContracted" INTEGER NOT NULL DEFAULT 0;
	ELSIF EXISTS (
		SELECT 1
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'User'
	) THEN
		ALTER TABLE "User"
			ADD COLUMN IF NOT EXISTS "adminActiveSeats" INTEGER NOT NULL DEFAULT 0,
			ADD COLUMN IF NOT EXISTS "adminExtraSeatsContracted" INTEGER NOT NULL DEFAULT 0;
	ELSE
		RAISE EXCEPTION 'Neither "users" nor "User" table exists in schema public.';
	END IF;
END $$;
