CREATE TABLE IF NOT EXISTS "favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"favorite_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "favorites" ADD CONSTRAINT "favorites_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "favorites" ADD CONSTRAINT "favorites_favorite_user_id_users_id_fk" FOREIGN KEY ("favorite_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "favorites_owner_favorite_uidx" ON "favorites" USING btree ("owner_id","favorite_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "favorites_owner_idx" ON "favorites" USING btree ("owner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "favorites_favorite_user_idx" ON "favorites" USING btree ("favorite_user_id");
