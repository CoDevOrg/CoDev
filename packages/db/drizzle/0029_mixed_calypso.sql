CREATE TYPE "public"."cli_client_type" AS ENUM('cli', 'mobile');--> statement-breakpoint
CREATE TYPE "public"."mobile_platform" AS ENUM('ios', 'android');--> statement-breakpoint
CREATE TABLE "mobile_push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"expo_push_token" text NOT NULL,
	"platform" "mobile_platform" NOT NULL,
	"device_id" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cli_access_tokens" ADD COLUMN "client_type" "cli_client_type" DEFAULT 'cli' NOT NULL;--> statement-breakpoint
ALTER TABLE "cli_device_authorizations" ADD COLUMN "client_type" "cli_client_type" DEFAULT 'cli' NOT NULL;--> statement-breakpoint
ALTER TABLE "mobile_push_tokens" ADD CONSTRAINT "mobile_push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_push_tokens_token_idx" ON "mobile_push_tokens" USING btree ("expo_push_token");--> statement-breakpoint
CREATE INDEX "mobile_push_tokens_user_idx" ON "mobile_push_tokens" USING btree ("user_id");