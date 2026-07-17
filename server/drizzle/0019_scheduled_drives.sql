ALTER TABLE "drives" ADD COLUMN "scheduled_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "reminder_sent_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drives_scheduled_at_idx" ON "drives" ("scheduled_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drives_reminder_due_idx" ON "drives" ("status", "scheduled_at") WHERE "status" = 'assigned' AND "reminder_sent_at" IS NULL;--> statement-breakpoint
-- Allow a future assigned job alongside a current ride. Keep at most one mid-ride.
DROP INDEX IF EXISTS "drives_one_active_assignee_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "drives_one_picked_up_assignee_uidx" ON "drives" ("assignee_id") WHERE "assignee_id" IS NOT NULL AND "status" = 'picked_up';
