CREATE TABLE IF NOT EXISTS "platform_fees" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "drive_id" uuid NOT NULL,
  "balance_id" uuid,
  "poster_id" uuid NOT NULL,
  "amount_cents" integer NOT NULL,
  "status" "balance_status" DEFAULT 'open' NOT NULL,
  "due_sunday" timestamp with time zone NOT NULL,
  "paid_at" timestamp with time zone,
  "settled_at" timestamp with time zone,
  "settlement_proof_key" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_fees" ADD CONSTRAINT "platform_fees_drive_id_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."drives"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "platform_fees" ADD CONSTRAINT "platform_fees_balance_id_balances_id_fk" FOREIGN KEY ("balance_id") REFERENCES "public"."balances"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "platform_fees" ADD CONSTRAINT "platform_fees_poster_id_users_id_fk" FOREIGN KEY ("poster_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_fees_drive_uidx" ON "platform_fees" USING btree ("drive_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_fees_poster_status_idx" ON "platform_fees" USING btree ("poster_id","status");
