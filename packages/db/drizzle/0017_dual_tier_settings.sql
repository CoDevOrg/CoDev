CREATE TYPE "public"."workspace_access_role" AS ENUM('owner', 'co_steer', 'reviewer', 'viewer');--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN "access_role" "workspace_access_role" DEFAULT 'viewer' NOT NULL;--> statement-breakpoint
UPDATE "workspace_members"
SET "access_role" = CASE
	WHEN "role" = 'owner' THEN 'owner'::"workspace_access_role"
	WHEN "can_merge" THEN 'co_steer'::"workspace_access_role"
	WHEN "can_terminal" THEN 'reviewer'::"workspace_access_role"
	ELSE 'viewer'::"workspace_access_role"
END;
