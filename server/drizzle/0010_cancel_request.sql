ALTER TABLE "drives" ADD COLUMN IF NOT EXISTS "cancel_requested_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "cancel_request" "notification_pref_mode" DEFAULT 'all' NOT NULL;
