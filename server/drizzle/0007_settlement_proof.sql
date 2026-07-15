ALTER TYPE "public"."photo_kind" ADD VALUE IF NOT EXISTS 'payment_proof';
--> statement-breakpoint
ALTER TABLE "balances" ADD COLUMN IF NOT EXISTS "settlement_proof_key" text;
