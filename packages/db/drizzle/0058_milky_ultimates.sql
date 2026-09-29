ALTER TABLE "provider_credentials" ADD COLUMN "allow_in_shared_workspaces" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Carry over the intent of the column this replaces: a member who had turned
-- a credential off for coding workspaces keeps it out of shared ones.
UPDATE "provider_credentials" SET "allow_in_shared_workspaces" = false WHERE "enabled_for_workspace" = false;
