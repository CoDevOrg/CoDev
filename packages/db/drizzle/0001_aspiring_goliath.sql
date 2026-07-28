CREATE TABLE "github_connections" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"encrypted_access_token" text NOT NULL,
	"encrypted_refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"token_type" text DEFAULT 'bearer' NOT NULL,
	"scope" text,
	"key_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD COLUMN "accepted_by" uuid;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "github_installation_id" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "github_repository_id" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "default_branch" text NOT NULL;--> statement-breakpoint
ALTER TABLE "github_connections" ADD CONSTRAINT "github_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_connections_access_expiry_idx" ON "github_connections" USING btree ("access_token_expires_at");--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspaces_repository_idx" ON "workspaces" USING btree ("github_repository_id");