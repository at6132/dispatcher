-- Resolve duplicate active assignees before enforcing uniqueness (keep newest).
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY assignee_id
      ORDER BY updated_at DESC, created_at DESC
    ) AS rn
  FROM drives
  WHERE assignee_id IS NOT NULL
    AND status IN ('assigned', 'picked_up')
),
dupes AS (
  SELECT id FROM ranked WHERE rn > 1
)
UPDATE applications
SET status = 'pending', updated_at = now()
WHERE drive_id IN (SELECT id FROM dupes)
  AND status = 'accepted';
--> statement-breakpoint
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY assignee_id
      ORDER BY updated_at DESC, created_at DESC
    ) AS rn
  FROM drives
  WHERE assignee_id IS NOT NULL
    AND status IN ('assigned', 'picked_up')
),
dupes AS (
  SELECT id FROM ranked WHERE rn > 1
)
UPDATE drives
SET status = 'open', assignee_id = NULL, updated_at = now()
WHERE id IN (SELECT id FROM dupes);
--> statement-breakpoint
-- At most one assigned/picked_up drive per driver (one active job at a time).
CREATE UNIQUE INDEX IF NOT EXISTS "drives_one_active_assignee_uidx"
  ON "drives" USING btree ("assignee_id")
  WHERE "assignee_id" IS NOT NULL AND "status" IN ('assigned', 'picked_up');
