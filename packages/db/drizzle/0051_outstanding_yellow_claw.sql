ALTER TABLE "gen2_workspaces" ADD COLUMN "github_installation_id" bigint;--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD COLUMN "github_repository_id" bigint;--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD COLUMN "repository" text;--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD COLUMN "repository_private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD COLUMN "default_branch" text;--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD COLUMN "base_sha" text;