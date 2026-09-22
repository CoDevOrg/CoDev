CREATE TYPE "public"."gen2_workspace_role" AS ENUM('owner', 'editor', 'viewer');--> statement-breakpoint
ALTER TABLE "gen2_workspace_members" ALTER COLUMN "role" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "gen2_workspace_members" ALTER COLUMN "role" SET DATA TYPE "public"."gen2_workspace_role" USING (CASE "role"::text WHEN 'owner' THEN 'owner' ELSE 'editor' END)::"public"."gen2_workspace_role";--> statement-breakpoint
ALTER TABLE "gen2_workspace_members" ALTER COLUMN "role" SET DEFAULT 'editor';
