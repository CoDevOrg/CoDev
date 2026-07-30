CREATE TYPE "public"."pilot_session_status" AS ENUM('running', 'blocked', 'completed');--> statement-breakpoint
CREATE TABLE "pilot_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"status" "pilot_session_status" DEFAULT 'running' NOT NULL,
	"checkpoints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"blocker_category" text,
	"release" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pilot_sessions" ADD CONSTRAINT "pilot_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_sessions" ADD CONSTRAINT "pilot_sessions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pilot_sessions_workspace_created_idx" ON "pilot_sessions" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "pilot_sessions_status_created_idx" ON "pilot_sessions" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pilot_sessions_active_workspace_idx"
ON "pilot_sessions" ("workspace_id")
WHERE "status" IN ('running', 'blocked');--> statement-breakpoint
ALTER TABLE "pilot_sessions"
ADD CONSTRAINT "pilot_sessions_checkpoints_object_check"
CHECK (jsonb_typeof("checkpoints") = 'object');--> statement-breakpoint
ALTER TABLE "pilot_sessions"
ADD CONSTRAINT "pilot_sessions_blocker_category_check"
CHECK (
  "blocker_category" IS NULL OR
  "blocker_category" IN ('access', 'collaboration', 'agent', 'publication', 'runtime', 'cost', 'other')
);--> statement-breakpoint
ALTER TABLE "pilot_sessions"
ADD CONSTRAINT "pilot_sessions_completion_check"
CHECK (
  ("status" = 'completed' AND "completed_at" IS NOT NULL AND "blocker_category" IS NULL) OR
  ("status" <> 'completed' AND "completed_at" IS NULL)
);--> statement-breakpoint
ALTER TABLE "design_partner_feedback"
ADD CONSTRAINT "design_partner_feedback_status_check"
CHECK ("status" IN ('new', 'reviewing', 'planned', 'resolved'));--> statement-breakpoint
ALTER TABLE "pilot_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "pilot_sessions" FROM anon, authenticated;
