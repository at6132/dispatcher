-- At most one assigned/picked_up drive per driver (one active job at a time).
CREATE UNIQUE INDEX IF NOT EXISTS "drives_one_active_assignee_uidx"
  ON "drives" USING btree ("assignee_id")
  WHERE "assignee_id" IS NOT NULL AND "status" IN ('assigned', 'picked_up');
