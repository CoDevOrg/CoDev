CREATE TYPE "public"."publication_status" AS ENUM('pending', 'published', 'failed');--> statement-breakpoint
ALTER TABLE "published_branches" ALTER COLUMN "commit_sha" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "published_branches" ALTER COLUMN "published_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "published_branches" ALTER COLUMN "published_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "published_branches" ADD COLUMN "status" "publication_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "published_branches" ADD COLUMN "source_head_sha" text;--> statement-breakpoint
ALTER TABLE "published_branches" ADD COLUMN "base_sha" text;--> statement-breakpoint
ALTER TABLE "published_branches" ADD COLUMN "repository_id" bigint;--> statement-breakpoint
ALTER TABLE "published_branches" ADD COLUMN "remote_ref" text;--> statement-breakpoint
ALTER TABLE "published_branches" ADD COLUMN "html_url" text;--> statement-breakpoint
ALTER TABLE "published_branches" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "published_branches" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "published_branches" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "published_branches" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "published_branches" AS publication
SET
  "status" = 'published',
  "source_head_sha" = publication."commit_sha",
  "base_sha" = publication."commit_sha",
  "repository_id" = workspace."github_repository_id",
  "remote_ref" = 'refs/heads/' || publication."branch_name",
  "request_id" = 'legacy-' || publication."id"::text
FROM "workspaces" AS workspace
WHERE workspace."id" = publication."workspace_id";--> statement-breakpoint
ALTER TABLE "published_branches" ALTER COLUMN "source_head_sha" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "published_branches" ALTER COLUMN "base_sha" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "published_branches" ALTER COLUMN "repository_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "published_branches" ALTER COLUMN "remote_ref" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "published_branches" ALTER COLUMN "request_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "published_branches_workspace_request_idx" ON "published_branches" USING btree ("workspace_id","request_id");--> statement-breakpoint
CREATE INDEX "published_branches_workspace_status_idx" ON "published_branches" USING btree ("workspace_id","status","updated_at");
