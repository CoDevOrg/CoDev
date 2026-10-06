CREATE TYPE "public"."gen2_agent_session_recovery_state" AS ENUM('not_required', 'required', 'restarting');--> statement-breakpoint
CREATE TYPE "public"."gen2_agent_session_status" AS ENUM('queued', 'running', 'stopped', 'completed', 'failed', 'recovery_required');--> statement-breakpoint
CREATE TABLE "gen2_agent_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"chat_id" uuid,
	"created_by" uuid NOT NULL,
	"task" text NOT NULL,
	"worktree_id" text NOT NULL,
	"provider" "credential_provider" NOT NULL,
	"status" "gen2_agent_session_status" DEFAULT 'queued' NOT NULL,
	"recovery_state" "gen2_agent_session_recovery_state" DEFAULT 'not_required' NOT NULL,
	"safe_output" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"final_changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gen2_superset_runs" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "gen2_agent_sessions" ADD CONSTRAINT "gen2_agent_sessions_workspace_id_gen2_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."gen2_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gen2_agent_sessions" ADD CONSTRAINT "gen2_agent_sessions_chat_id_gen2_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."gen2_chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gen2_agent_sessions" ADD CONSTRAINT "gen2_agent_sessions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gen2_agent_sessions_workspace_updated_idx" ON "gen2_agent_sessions" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "gen2_agent_sessions_creator_updated_idx" ON "gen2_agent_sessions" USING btree ("created_by","updated_at");--> statement-breakpoint
ALTER TABLE "gen2_superset_runs" ADD CONSTRAINT "gen2_superset_runs_session_id_gen2_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."gen2_agent_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gen2_superset_runs_session_idx" ON "gen2_superset_runs" USING btree ("session_id","created_at");