CREATE TYPE "public"."credential_provider" AS ENUM('anthropic', 'openai', 'bedrock', 'azure_foundry', 'cursor', 'custom');--> statement-breakpoint
CREATE TYPE "public"."credential_scope_type" AS ENUM('USER', 'WORKSPACE');--> statement-breakpoint
CREATE TYPE "public"."credential_type" AS ENUM('API_KEY', 'OAUTH_TOKEN', 'AWS_BEDROCK_ROLE', 'AZURE_ENDPOINT');--> statement-breakpoint
ALTER TABLE "provider_credentials" DROP CONSTRAINT "provider_credentials_user_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "provider_credentials_user_provider_idx";--> statement-breakpoint
ALTER TABLE "provider_credentials" ALTER COLUMN "provider" SET DATA TYPE "public"."credential_provider" USING "provider"::"public"."credential_provider";--> statement-breakpoint
ALTER TABLE "provider_credentials" ALTER COLUMN "last_four" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "scope_type" "credential_scope_type";--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "scope_id" uuid;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "credential_type" "credential_type";--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "priority_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "encrypted_api_key" text;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "encrypted_access_token" text;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "encrypted_refresh_token" text;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "endpoint_url" text;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "aws_role_arn" text;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "is_connected" boolean DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE "provider_credentials"
SET
  "scope_type" = 'USER',
  "scope_id" = "user_id",
  "credential_type" = 'API_KEY',
  "encrypted_api_key" = "encrypted_value";--> statement-breakpoint
ALTER TABLE "provider_credentials" ALTER COLUMN "scope_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_credentials" ALTER COLUMN "scope_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_credentials" ALTER COLUMN "credential_type" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_credentials_scope_provider_type_idx" ON "provider_credentials" USING btree ("scope_type","scope_id","provider","credential_type");--> statement-breakpoint
CREATE INDEX "provider_credentials_scope_provider_priority_idx" ON "provider_credentials" USING btree ("scope_type","scope_id","provider","priority_order");--> statement-breakpoint
ALTER TABLE "provider_credentials" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "provider_credentials" DROP COLUMN "encrypted_value";
