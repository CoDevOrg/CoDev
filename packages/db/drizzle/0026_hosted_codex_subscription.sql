ALTER TYPE "public"."credential_scope_type" ADD VALUE 'ORGANIZATION';--> statement-breakpoint
ALTER TYPE "public"."credential_type" ADD VALUE 'HOSTED_CODEX_SUBSCRIPTION';--> statement-breakpoint
CREATE TYPE "public"."provider_credential_status" AS ENUM('active', 'reauthorization_required', 'revoked', 'failed');--> statement-breakpoint
CREATE TYPE "public"."hosted_codex_runtime_grant_status" AS ENUM('minted', 'delivered', 'consumed', 'expired', 'revoked');--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "status" "provider_credential_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "provider_subject_hash" text;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "encrypted_material" text;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "last_refreshed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "sharing_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "unavailable_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_credentials_status_idx" ON "provider_credentials" USING btree ("status");--> statement-breakpoint
CREATE TABLE "hosted_codex_connection_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scope_type" "credential_scope_type" NOT NULL,
	"scope_id" uuid NOT NULL,
	"return_to" text NOT NULL,
	"state" text NOT NULL,
	"code_verifier" text NOT NULL,
	"nonce" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hosted_codex_connection_attempts" ADD CONSTRAINT "hosted_codex_connection_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hosted_codex_connection_attempts_state_idx" ON "hosted_codex_connection_attempts" USING btree ("state");--> statement-breakpoint
CREATE INDEX "hosted_codex_connection_attempts_user_expiry_idx" ON "hosted_codex_connection_attempts" USING btree ("user_id","expires_at");--> statement-breakpoint
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
ALTER TABLE "provider_credential_events" ADD CONSTRAINT "provider_credential_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_credential_events" ADD CONSTRAINT "provider_credential_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_credential_events_credential_created_idx" ON "provider_credential_events" USING btree ("credential_id","created_at");--> statement-breakpoint
CREATE INDEX "provider_credential_events_actor_created_idx" ON "provider_credential_events" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE TABLE "hosted_codex_runtime_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credential_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"audience" text NOT NULL,
	"encrypted_grant" text NOT NULL,
	"status" "hosted_codex_runtime_grant_status" DEFAULT 'minted' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hosted_codex_runtime_grants" ADD CONSTRAINT "hosted_codex_runtime_grants_credential_id_provider_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."provider_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosted_codex_runtime_grants" ADD CONSTRAINT "hosted_codex_runtime_grants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosted_codex_runtime_grants" ADD CONSTRAINT "hosted_codex_runtime_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hosted_codex_runtime_grants_workspace_status_idx" ON "hosted_codex_runtime_grants" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "hosted_codex_runtime_grants_credential_idx" ON "hosted_codex_runtime_grants" USING btree ("credential_id");
