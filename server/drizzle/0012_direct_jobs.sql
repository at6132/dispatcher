ALTER TABLE "drives" ADD COLUMN IF NOT EXISTS "invited_driver_id" uuid;-->statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "drives" ADD CONSTRAINT "drives_invited_driver_id_users_id_fk" FOREIGN KEY ("invited_driver_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;-->statement-breakpoint
CREATE INDEX IF NOT EXISTS "drives_invited_driver_idx" ON "drives" USING btree ("invited_driver_id");
