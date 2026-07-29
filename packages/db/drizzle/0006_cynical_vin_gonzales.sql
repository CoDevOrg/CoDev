CREATE TABLE "collaboration_conflict_resolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worktree_id" uuid NOT NULL,
	"path" text NOT NULL,
	"resolved_by" uuid NOT NULL,
	"strategy" text NOT NULL,
	"snapshot_revision" text NOT NULL,
	"filesystem_revision" text NOT NULL,
	"result_revision" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_issue_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"github_repository_id" bigint NOT NULL,
	"issue_number" integer NOT NULL,
	"github_issue_id" bigint NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coordination_messages" ADD COLUMN "correlation_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "coordination_messages" ADD COLUMN "response_to_id" uuid;--> statement-breakpoint
ALTER TABLE "worktrees" ADD COLUMN "review_head_sha" text;--> statement-breakpoint
ALTER TABLE "worktrees" ADD COLUMN "review_base_sha" text;--> statement-breakpoint
ALTER TABLE "worktrees" ADD COLUMN "review_diff_digest" text;--> statement-breakpoint
ALTER TABLE "worktrees" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "worktrees" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "worktrees" ADD COLUMN "merged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "worktrees" ADD COLUMN "discarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "yjs_snapshots" ADD COLUMN "conflict_detected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "yjs_snapshots" ADD COLUMN "conflict_resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "yjs_snapshots" ADD COLUMN "conflict_resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "yjs_snapshots" ADD COLUMN "conflict_resolution" text;--> statement-breakpoint
ALTER TABLE "collaboration_conflict_resolutions" ADD CONSTRAINT "collaboration_conflict_resolutions_worktree_id_worktrees_id_fk" FOREIGN KEY ("worktree_id") REFERENCES "public"."worktrees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaboration_conflict_resolutions" ADD CONSTRAINT "collaboration_conflict_resolutions_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_issue_assignments" ADD CONSTRAINT "github_issue_assignments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_issue_assignments" ADD CONSTRAINT "github_issue_assignments_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collaboration_conflict_resolutions_document_idx" ON "collaboration_conflict_resolutions" USING btree ("worktree_id","path","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "github_issue_assignments_repository_issue_idx" ON "github_issue_assignments" USING btree ("github_repository_id","issue_number");--> statement-breakpoint
CREATE UNIQUE INDEX "github_issue_assignments_session_idx" ON "github_issue_assignments" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "github_issue_assignments_workspace_idx" ON "github_issue_assignments" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "worktrees" ADD CONSTRAINT "worktrees_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yjs_snapshots" ADD CONSTRAINT "yjs_snapshots_conflict_resolved_by_users_id_fk" FOREIGN KEY ("conflict_resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaboration_conflict_resolutions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "github_issue_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "collaboration_conflict_resolutions" FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON TABLE "github_issue_assignments" FROM anon, authenticated;
