DO $$ BEGIN
 CREATE TYPE "public"."driver_availability" AS ENUM('available', 'busy', 'offline');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;-->statement-breakpoint
ALTER TABLE "driver_profiles" ADD COLUMN IF NOT EXISTS "availability" "driver_availability" DEFAULT 'offline' NOT NULL;-->statement-breakpoint
ALTER TABLE "driver_profiles" ADD COLUMN IF NOT EXISTS "last_lat" numeric(10, 7);-->statement-breakpoint
ALTER TABLE "driver_profiles" ADD COLUMN IF NOT EXISTS "last_lng" numeric(10, 7);-->statement-breakpoint
ALTER TABLE "driver_profiles" ADD COLUMN IF NOT EXISTS "location_updated_at" timestamp with time zone;
