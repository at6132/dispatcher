-- Aaron's favorites used user_id; Avi's code expects owner_id.
-- 0008 used CREATE TABLE IF NOT EXISTS so the old shape was left in place.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'favorites'
      AND column_name = 'user_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'favorites'
      AND column_name = 'owner_id'
  ) THEN
    ALTER TABLE "favorites" RENAME COLUMN "user_id" TO "owner_id";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'favorites_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "favorites" RENAME CONSTRAINT "favorites_user_id_users_id_fk" TO "favorites_owner_id_users_id_fk";
  END IF;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "favorites_user_favorite_uidx";
--> statement-breakpoint
DROP INDEX IF EXISTS "favorites_user_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "favorites_owner_favorite_uidx" ON "favorites" USING btree ("owner_id","favorite_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "favorites_owner_idx" ON "favorites" USING btree ("owner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "favorites_favorite_user_idx" ON "favorites" USING btree ("favorite_user_id");
