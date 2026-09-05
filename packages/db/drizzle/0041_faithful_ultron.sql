CREATE TYPE "public"."claude_connection_session_status" AS ENUM('starting', 'awaiting_code', 'exchanging', 'connected', 'failed');--> statement-breakpoint
CREATE TABLE "claude_connection_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scope_type" "credential_scope_type" DEFAULT 'USER' NOT NULL,
	"scope_id" uuid NOT NULL,
	"status" "claude_connection_session_status" DEFAULT 'starting' NOT NULL,
	"runner_id" text,
	"authorize_url" text,
	"failure_reason" text,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claude_connection_sessions" ADD CONSTRAINT "claude_connection_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claude_connection_sessions_user_idx" ON "claude_connection_sessions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "claude_connection_sessions_expiry_idx" ON "claude_connection_sessions" USING btree ("expires_at");