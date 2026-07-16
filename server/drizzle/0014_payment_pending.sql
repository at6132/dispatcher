ALTER TYPE "public"."balance_status" ADD VALUE IF NOT EXISTS 'payment_pending' BEFORE 'settled';
--> statement-breakpoint
ALTER TABLE "balances" ADD COLUMN IF NOT EXISTS "paid_at" timestamp with time zone;
