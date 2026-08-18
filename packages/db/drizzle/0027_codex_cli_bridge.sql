DROP TABLE IF EXISTS "hosted_codex_runtime_grants";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."hosted_codex_runtime_grant_status";--> statement-breakpoint
DROP TABLE IF EXISTS "hosted_codex_connection_attempts";--> statement-breakpoint
CREATE TYPE "public"."cli_device_authorization_status" AS ENUM('pending', 'approved', 'denied');--> statement-breakpoint
CREATE TABLE "cli_device_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_code_hash" text NOT NULL,
	"user_code" text NOT NULL,
	"status" "cli_device_authorization_status" DEFAULT 'pending' NOT NULL,
	"approved_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cli_device_authorizations_device_code_idx" UNIQUE("device_code_hash"),
	CONSTRAINT "cli_device_authorizations_user_code_idx" UNIQUE("user_code")
);--> statement-breakpoint
CREATE TABLE "cli_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"name" text DEFAULT 'CoDev CLI' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cli_access_tokens_token_hash_idx" UNIQUE("token_hash")
);--> statement-breakpoint
ALTER TABLE "cli_device_authorizations" ADD CONSTRAINT "cli_device_authorizations_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_access_tokens" ADD CONSTRAINT "cli_access_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cli_device_authorizations_expiry_idx" ON "cli_device_authorizations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "cli_access_tokens_user_idx" ON "cli_access_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cli_access_tokens_expiry_idx" ON "cli_access_tokens" USING btree ("expires_at");
