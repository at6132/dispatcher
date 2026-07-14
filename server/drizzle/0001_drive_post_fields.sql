CREATE TYPE "public"."trip_type" AS ENUM('one_way', 'round_trip');--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "vehicle_class" "vehicle_class" DEFAULT 'sedan' NOT NULL;--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "seats" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "trip_type" "trip_type" DEFAULT 'one_way' NOT NULL;--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "extra_info" text;
