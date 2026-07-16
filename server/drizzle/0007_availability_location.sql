CREATE TYPE "public"."driver_availability" AS ENUM('available', 'busy', 'offline');-->statement-breakpoint
ALTER TABLE "driver_profiles" ADD COLUMN "availability" "driver_availability" DEFAULT 'offline' NOT NULL;-->statement-breakpoint
ALTER TABLE "driver_profiles" ADD COLUMN "last_lat" numeric(10, 7);-->statement-breakpoint
ALTER TABLE "driver_profiles" ADD COLUMN "last_lng" numeric(10, 7);-->statement-breakpoint
ALTER TABLE "driver_profiles" ADD COLUMN "location_updated_at" timestamp with time zone;
