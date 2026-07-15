ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "application_cleared" "notification_pref_mode" DEFAULT 'all' NOT NULL;
