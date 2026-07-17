-- 0007 was recorded as applied, but balances.settlement_proof_key is missing
-- in production (Drizzle RETURNING on complete then 500s).
ALTER TABLE "balances" ADD COLUMN IF NOT EXISTS "settlement_proof_key" text;
