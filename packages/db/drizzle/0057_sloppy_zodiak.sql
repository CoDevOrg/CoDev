CREATE TYPE "public"."gen2_superset_run_status" AS ENUM('creating', 'running', 'stopping', 'finished', 'failed', 'recovery_required');--> statement-breakpoint
CREATE TABLE "gen2_superset_run_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_id" uuid,
	"type" text NOT NULL,
	"result" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gen2_superset_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"chat_id" uuid,
	"created_by" uuid NOT NULL,
	"worktree_id" text NOT NULL,
	"host_workspace_id" text,
	"host_terminal_id" text,
	"host_agent_session_id" text,
	"provider" "credential_provider" NOT NULL,
	"connection_id" uuid,
	"credential_revision" text,
	"status" "gen2_superset_run_status" DEFAULT 'creating' NOT NULL,
	"lease_claimed" boolean DEFAULT false NOT NULL,
	"exit_reason" text,
	"recovery_count" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gen2_superset_run_events" ADD CONSTRAINT "gen2_superset_run_events_run_id_gen2_superset_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."gen2_superset_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gen2_superset_run_events" ADD CONSTRAINT "gen2_superset_run_events_workspace_id_gen2_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."gen2_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gen2_superset_run_events" ADD CONSTRAINT "gen2_superset_run_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gen2_superset_runs" ADD CONSTRAINT "gen2_superset_runs_workspace_id_gen2_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."gen2_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gen2_superset_runs" ADD CONSTRAINT "gen2_superset_runs_chat_id_gen2_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."gen2_chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gen2_superset_runs" ADD CONSTRAINT "gen2_superset_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gen2_superset_runs" ADD CONSTRAINT "gen2_superset_runs_connection_id_provider_credentials_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gen2_superset_run_events_run_created_idx" ON "gen2_superset_run_events" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gen2_superset_runs_workspace_idempotency_idx" ON "gen2_superset_runs" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "gen2_superset_runs_workspace_status_idx" ON "gen2_superset_runs" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "gen2_superset_runs_chat_idx" ON "gen2_superset_runs" USING btree ("chat_id","created_at");