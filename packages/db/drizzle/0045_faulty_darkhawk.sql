CREATE TYPE "public"."agent_session_import_status" AS ENUM('storing', 'stored', 'restoring', 'ready', 'launching', 'active', 'failed', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."repository_restore_status" AS ENUM('pending', 'matched', 'restored', 'conflicted', 'unavailable', 'transcript_only');--> statement-breakpoint
CREATE TYPE "public"."session_continuation_mode" AS ENUM('managed', 'native_resume');--> statement-breakpoint
CREATE TABLE "agent_session_import_artifacts" (
	"import_id" uuid PRIMARY KEY NOT NULL,
	"media_type" text NOT NULL,
	"plaintext_sha256" text NOT NULL,
	"plaintext_bytes" integer NOT NULL,
	"encrypted_payload" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_session_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"imported_by" uuid NOT NULL,
	"parent_import_id" uuid,
	"worktree_id" uuid,
	"agent_session_id" uuid,
	"source_provider" text NOT NULL,
	"external_session_id" text NOT NULL,
	"capsule_schema_version" integer NOT NULL,
	"capsule_sha256" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "agent_session_import_status" DEFAULT 'storing' NOT NULL,
	"repository_status" "repository_restore_status" DEFAULT 'pending' NOT NULL,
	"continuation_mode" "session_continuation_mode",
	"last_error" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_session_import_artifacts" ADD CONSTRAINT "agent_session_import_artifacts_import_id_agent_session_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."agent_session_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_imports" ADD CONSTRAINT "agent_session_imports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_imports" ADD CONSTRAINT "agent_session_imports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_imports" ADD CONSTRAINT "agent_session_imports_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_imports" ADD CONSTRAINT "agent_session_imports_parent_import_id_agent_session_imports_id_fk" FOREIGN KEY ("parent_import_id") REFERENCES "public"."agent_session_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_imports" ADD CONSTRAINT "agent_session_imports_worktree_id_worktrees_id_fk" FOREIGN KEY ("worktree_id") REFERENCES "public"."worktrees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_imports" ADD CONSTRAINT "agent_session_imports_agent_session_id_agent_sessions_id_fk" FOREIGN KEY ("agent_session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_session_import_artifacts_created_idx" ON "agent_session_import_artifacts" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_session_imports_idempotency_idx" ON "agent_session_imports" USING btree ("workspace_id","imported_by","idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_session_imports_workspace_status_idx" ON "agent_session_imports" USING btree ("workspace_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "agent_session_imports_importer_idx" ON "agent_session_imports" USING btree ("imported_by","created_at");--> statement-breakpoint
CREATE INDEX "agent_session_imports_source_idx" ON "agent_session_imports" USING btree ("imported_by","source_provider","external_session_id");--> statement-breakpoint
CREATE INDEX "agent_session_imports_parent_idx" ON "agent_session_imports" USING btree ("parent_import_id");