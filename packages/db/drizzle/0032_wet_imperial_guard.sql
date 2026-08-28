CREATE TYPE "public"."agent_brief_status" AS ENUM('planning', 'active', 'blocked', 'paused', 'done');--> statement-breakpoint
CREATE TYPE "public"."brain_entry_kind" AS ENUM('decision', 'attempt', 'dead_end', 'finding', 'convention', 'handoff');--> statement-breakpoint
CREATE TYPE "public"."brain_overlap_kind" AS ENUM('duplicate_intent', 'file_overlap', 'claim_contest');--> statement-breakpoint
CREATE TYPE "public"."brain_overlap_status" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TABLE "agent_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"goal" text DEFAULT '' NOT NULL,
	"approach_summary" text DEFAULT '' NOT NULL,
	"plan_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_step" text DEFAULT '' NOT NULL,
	"files_likely_to_touch" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "agent_brief_status" DEFAULT 'planning' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brain_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid,
	"author_id" uuid,
	"kind" "brain_entry_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brain_overlaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"left_session_id" uuid NOT NULL,
	"right_session_id" uuid NOT NULL,
	"kind" "brain_overlap_kind" NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"status" "brain_overlap_status" DEFAULT 'open' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_briefs" ADD CONSTRAINT "agent_briefs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_briefs" ADD CONSTRAINT "agent_briefs_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_entries" ADD CONSTRAINT "brain_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_entries" ADD CONSTRAINT "brain_entries_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_entries" ADD CONSTRAINT "brain_entries_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_overlaps" ADD CONSTRAINT "brain_overlaps_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_overlaps" ADD CONSTRAINT "brain_overlaps_left_session_id_agent_sessions_id_fk" FOREIGN KEY ("left_session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_overlaps" ADD CONSTRAINT "brain_overlaps_right_session_id_agent_sessions_id_fk" FOREIGN KEY ("right_session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_briefs_session_idx" ON "agent_briefs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "agent_briefs_workspace_status_idx" ON "agent_briefs" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "brain_entries_workspace_created_idx" ON "brain_entries" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "brain_entries_workspace_kind_idx" ON "brain_entries" USING btree ("workspace_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "brain_overlaps_pair_kind_idx" ON "brain_overlaps" USING btree ("workspace_id","left_session_id","right_session_id","kind");--> statement-breakpoint
CREATE INDEX "brain_overlaps_workspace_status_idx" ON "brain_overlaps" USING btree ("workspace_id","status");