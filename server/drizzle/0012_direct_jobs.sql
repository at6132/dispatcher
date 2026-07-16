ALTER TABLE "drives" ADD COLUMN "invited_driver_id" uuid;-->statement-breakpoint
ALTER TABLE "drives" ADD CONSTRAINT "drives_invited_driver_id_users_id_fk" FOREIGN KEY ("invited_driver_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;-->statement-breakpoint
CREATE INDEX "drives_invited_driver_idx" ON "drives" USING btree ("invited_driver_id");
