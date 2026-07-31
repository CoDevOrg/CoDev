ALTER TABLE "agent_sessions" ALTER COLUMN "model" SET DEFAULT 'gpt-5';--> statement-breakpoint
UPDATE "agent_sessions"
SET "model" = 'gpt-5'
WHERE "model" = 'gpt-5.6-sol';--> statement-breakpoint
UPDATE "workspaces"
SET "hibernate_at" = COALESCE("last_activity_at", "updated_at", now()) + interval '4 hours'
WHERE "status" = 'ready' AND "hibernate_at" IS NULL;--> statement-breakpoint
UPDATE "workspace_runtimes"
SET "last_heartbeat_at" = COALESCE("provisioned_at", "updated_at", now())
WHERE "status" = 'ready' AND "last_heartbeat_at" IS NULL;
