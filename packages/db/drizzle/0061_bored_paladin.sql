-- Collapse the two spellings of "shared" onto one scope before narrowing the
-- type. An ORGANIZATION credential's scope id was already a workspace id, so
-- this is a relabel, not a move. Drop any row that would collide with a
-- WORKSPACE row already holding that (workspace, provider, type): the older
-- fallback-pool entry is the one the resolvers have been reading.
DELETE FROM "provider_credentials" AS organization
USING "provider_credentials" AS workspace
WHERE organization."scope_type" = 'ORGANIZATION'
  AND workspace."scope_type" = 'WORKSPACE'
  AND workspace."scope_id" = organization."scope_id"
  AND workspace."provider" = organization."provider"
  AND workspace."credential_type" = organization."credential_type";--> statement-breakpoint
UPDATE "provider_credentials" SET "scope_type" = 'WORKSPACE' WHERE "scope_type" = 'ORGANIZATION';--> statement-breakpoint
UPDATE "provider_credential_events" SET "scope_type" = 'WORKSPACE' WHERE "scope_type" = 'ORGANIZATION';--> statement-breakpoint
UPDATE "claude_connection_sessions" SET "scope_type" = 'WORKSPACE' WHERE "scope_type" = 'ORGANIZATION';--> statement-breakpoint
ALTER TABLE "claude_connection_sessions" ALTER COLUMN "scope_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "claude_connection_sessions" ALTER COLUMN "scope_type" SET DEFAULT 'USER'::text;--> statement-breakpoint
ALTER TABLE "provider_credential_events" ALTER COLUMN "scope_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "provider_credentials" ALTER COLUMN "scope_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."credential_scope_type";--> statement-breakpoint
CREATE TYPE "public"."credential_scope_type" AS ENUM('USER', 'WORKSPACE');--> statement-breakpoint
ALTER TABLE "claude_connection_sessions" ALTER COLUMN "scope_type" SET DEFAULT 'USER'::"public"."credential_scope_type";--> statement-breakpoint
ALTER TABLE "claude_connection_sessions" ALTER COLUMN "scope_type" SET DATA TYPE "public"."credential_scope_type" USING "scope_type"::"public"."credential_scope_type";--> statement-breakpoint
ALTER TABLE "provider_credential_events" ALTER COLUMN "scope_type" SET DATA TYPE "public"."credential_scope_type" USING "scope_type"::"public"."credential_scope_type";--> statement-breakpoint
ALTER TABLE "provider_credentials" ALTER COLUMN "scope_type" SET DATA TYPE "public"."credential_scope_type" USING "scope_type"::"public"."credential_scope_type";