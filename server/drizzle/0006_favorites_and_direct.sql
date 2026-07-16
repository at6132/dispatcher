ALTER TABLE "drives" ADD COLUMN "invited_driver_id" uuid;-->statement-breakpoint
ALTER TABLE "drives" ADD CONSTRAINT "drives_invited_driver_id_users_id_fk" FOREIGN KEY ("invited_driver_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;-->statement-breakpoint
CREATE INDEX "drives_invited_driver_idx" ON "drives" USING btree ("invited_driver_id");-->statement-breakpoint
CREATE TABLE "favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"favorite_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);-->statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;-->statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_favorite_user_id_users_id_fk" FOREIGN KEY ("favorite_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;-->statement-breakpoint
CREATE UNIQUE INDEX "favorites_user_favorite_uidx" ON "favorites" USING btree ("user_id","favorite_user_id");-->statement-breakpoint
CREATE INDEX "favorites_user_idx" ON "favorites" USING btree ("user_id");
