CREATE TYPE "public"."cli_device_authorization_status" AS ENUM('pending', 'approved', 'denied');--> statement-breakpoint
CREATE TYPE "public"."provider_credential_status" AS ENUM('active', 'reauthorization_required', 'revoked', 'failed');--> statement-breakpoint
ALTER TYPE "public"."credential_scope_type" ADD VALUE 'ORGANIZATION';--> statement-breakpoint
ALTER TYPE "public"."credential_type" ADD VALUE 'HOSTED_CODEX_SUBSCRIPTION';--> statement-breakpoint
CREATE TABLE "cli_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"name" text DEFAULT 'CoDev CLI' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cli_device_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_code_hash" text NOT NULL,
	"user_code" text NOT NULL,
	"status" "cli_device_authorization_status" DEFAULT 'pending' NOT NULL,
	"approved_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_credential_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credential_id" uuid,
	"actor_id" uuid,
	"provider" "credential_provider" NOT NULL,
	"kind" text NOT NULL,
	"type" text NOT NULL,
	"scope_type" "credential_scope_type",
	"scope_id" uuid,
	"workspace_id" uuid,
	"result" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_environment_variables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"last_four" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "status" "provider_credential_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "provider_subject_hash" text;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "encrypted_material" text;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "last_refreshed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "sharing_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "unavailable_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cli_access_tokens" ADD CONSTRAINT "cli_access_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_device_authorizations" ADD CONSTRAINT "cli_device_authorizations_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_credential_events" ADD CONSTRAINT "provider_credential_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_credential_events" ADD CONSTRAINT "provider_credential_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_environment_variables" ADD CONSTRAINT "user_environment_variables_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cli_access_tokens_token_hash_idx" ON "cli_access_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "cli_access_tokens_user_idx" ON "cli_access_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cli_access_tokens_expiry_idx" ON "cli_access_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cli_device_authorizations_device_code_idx" ON "cli_device_authorizations" USING btree ("device_code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "cli_device_authorizations_user_code_idx" ON "cli_device_authorizations" USING btree ("user_code");--> statement-breakpoint
CREATE INDEX "cli_device_authorizations_expiry_idx" ON "cli_device_authorizations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "provider_credential_events_credential_created_idx" ON "provider_credential_events" USING btree ("credential_id","created_at");--> statement-breakpoint
CREATE INDEX "provider_credential_events_actor_created_idx" ON "provider_credential_events" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_environment_variables_user_name_idx" ON "user_environment_variables" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "user_environment_variables_user_updated_idx" ON "user_environment_variables" USING btree ("user_id","updated_at");--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_credentials_status_idx" ON "provider_credentials" USING btree ("status");