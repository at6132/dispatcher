CREATE TYPE "public"."admin_challenge_status" AS ENUM('pending', 'approved', 'denied', 'expired');-->statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('admin', 'system', 'user');-->statement-breakpoint
CREATE TYPE "public"."security_severity" AS ENUM('info', 'warn', 'critical');-->statement-breakpoint
CREATE TABLE "admin_login_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"short_code" text NOT NULL,
	"status" "admin_challenge_status" DEFAULT 'pending' NOT NULL,
	"ip" text NOT NULL,
	"user_agent" text,
	"approved_by_chat_id" text,
	"approved_at" timestamp with time zone,
	"session_token_hash" text,
	"session_issued_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);-->statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"challenge_id" uuid,
	"ip" text NOT NULL,
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);-->statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"session_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"request_id" text,
	"ip" text,
	"user_agent" text,
	"before_json" text,
	"after_json" text,
	"meta_json" text
);-->statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"user_id" uuid,
	"anonymous_id" text,
	"request_id" text,
	"ip" text,
	"props_json" text
);-->statement-breakpoint
CREATE TABLE "security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"severity" "security_severity" DEFAULT 'info' NOT NULL,
	"ip" text,
	"user_id" uuid,
	"admin_challenge_id" uuid,
	"request_id" text,
	"detail_json" text
);-->statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_challenge_id_admin_login_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."admin_login_challenges"("id") ON DELETE set null ON UPDATE no action;-->statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;-->statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;-->statement-breakpoint
CREATE UNIQUE INDEX "admin_challenges_short_code_uidx" ON "admin_login_challenges" USING btree ("short_code");-->statement-breakpoint
CREATE INDEX "admin_challenges_status_created_idx" ON "admin_login_challenges" USING btree ("status","created_at");-->statement-breakpoint
CREATE UNIQUE INDEX "admin_sessions_token_hash_uidx" ON "admin_sessions" USING btree ("token_hash");-->statement-breakpoint
CREATE INDEX "admin_sessions_expires_idx" ON "admin_sessions" USING btree ("expires_at");-->statement-breakpoint
CREATE INDEX "audit_events_at_idx" ON "audit_events" USING btree ("at");-->statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("action");-->statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");-->statement-breakpoint
CREATE INDEX "audit_events_request_idx" ON "audit_events" USING btree ("request_id");-->statement-breakpoint
CREATE INDEX "audit_events_ip_idx" ON "audit_events" USING btree ("ip");-->statement-breakpoint
CREATE INDEX "analytics_events_name_at_idx" ON "analytics_events" USING btree ("name","at");-->statement-breakpoint
CREATE INDEX "analytics_events_user_idx" ON "analytics_events" USING btree ("user_id");-->statement-breakpoint
CREATE INDEX "analytics_events_at_idx" ON "analytics_events" USING btree ("at");-->statement-breakpoint
CREATE INDEX "security_events_at_idx" ON "security_events" USING btree ("at");-->statement-breakpoint
CREATE INDEX "security_events_kind_idx" ON "security_events" USING btree ("kind");-->statement-breakpoint
CREATE INDEX "security_events_ip_idx" ON "security_events" USING btree ("ip");-->statement-breakpoint
CREATE INDEX "security_events_request_idx" ON "security_events" USING btree ("request_id");
