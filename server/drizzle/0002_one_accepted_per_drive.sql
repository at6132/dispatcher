CREATE UNIQUE INDEX IF NOT EXISTS "applications_one_accepted_uidx" ON "applications" USING btree ("drive_id") WHERE "status" = 'accepted';
