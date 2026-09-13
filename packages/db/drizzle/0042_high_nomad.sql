CREATE TYPE "public"."credential_connected_via" AS ENUM('browser', 'cli', 'api_key');--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "connected_via" "credential_connected_via";--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "enabled_for_rooms" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "enabled_for_workspace" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Backfill provenance for pre-existing rows. Key-like credentials are workspace-
-- eligible. Everything else is treated as browser (rooms-only): a browser-vs-CLI
-- Codex subscription is indistinguishable after the fact, and a legacy Claude
-- OAUTH_TOKEN cannot be told from a CLI setup-token, so neither is promoted to the
-- workspace by guesswork. A member who connected via `codev {provider}-auth`
-- reconnects once to get a row stamped 'cli'.
UPDATE "provider_credentials" SET "connected_via" = 'api_key' WHERE "connected_via" IS NULL AND "credential_type" IN ('API_KEY', 'AWS_BEDROCK_ROLE', 'AZURE_ENDPOINT');--> statement-breakpoint
UPDATE "provider_credentials" SET "connected_via" = 'browser' WHERE "connected_via" IS NULL;