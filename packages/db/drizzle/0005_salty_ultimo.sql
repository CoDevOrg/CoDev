CREATE TABLE "agent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "name" text DEFAULT 'Agent' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "model" text DEFAULT 'gpt-5.6-sol' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "workflow_run_id" text;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "interrupted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_turns" ADD COLUMN "response_id" text;--> statement-breakpoint
ALTER TABLE "agent_turns" ADD COLUMN "output" text;--> statement-breakpoint
ALTER TABLE "agent_turns" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "agent_turns" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_turns" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_turn_id_agent_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."agent_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_events_idempotency_idx" ON "agent_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_events_session_created_idx" ON "agent_events" USING btree ("session_id","created_at");
--> statement-breakpoint
ALTER TABLE "agent_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "agent_events" FROM anon, authenticated;
