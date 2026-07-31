CREATE TYPE "public"."workspace_access_role" AS ENUM('owner', 'co_steer', 'reviewer', 'viewer');--> statement-breakpoint
ALTER TYPE "public"."sandbox_runtime_status" ADD VALUE 'hibernated' BEFORE 'stopping';--> statement-breakpoint
ALTER TYPE "public"."workspace_status" ADD VALUE 'hibernated' BEFORE 'stopping';--> statement-breakpoint
CREATE TABLE "workspace_state_documents" (
	"document_name" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"state" bytea NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD COLUMN "invitee_email" text;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD COLUMN "invitee_login" text;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD COLUMN "access_role" "workspace_access_role" DEFAULT 'viewer' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD COLUMN "allow_link" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN "access_role" "workspace_access_role" DEFAULT 'viewer' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_runtimes" ADD COLUMN "snapshot_ref" text;--> statement-breakpoint
ALTER TABLE "workspace_runtimes" ADD COLUMN "last_heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_runtimes" ADD COLUMN "hibernated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "hibernate_at" timestamp with time zone;--> statement-breakpoint
UPDATE "workspace_members"
SET "access_role" = CASE
	WHEN "role" = 'owner' THEN 'owner'::"workspace_access_role"
	WHEN "can_merge" THEN 'co_steer'::"workspace_access_role"
	WHEN "can_terminal" THEN 'reviewer'::"workspace_access_role"
	ELSE 'viewer'::"workspace_access_role"
END;--> statement-breakpoint
UPDATE "workspace_invites"
SET "access_role" = 'co_steer', "allow_link" = true;--> statement-breakpoint
ALTER TABLE "workspace_state_documents" ADD CONSTRAINT "workspace_state_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_state_documents_workspace_idx" ON "workspace_state_documents" USING btree ("workspace_id");
