CREATE TYPE "public"."gen2_workspace_status" AS ENUM('pending', 'provisioning', 'ready', 'failed', 'stopped');--> statement-breakpoint
CREATE TABLE "gen2_workspace_members" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gen2_workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "gen2_workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "gen2_workspace_status" DEFAULT 'pending' NOT NULL,
	"sandbox_id" text,
	"last_error" text,
	"share_token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gen2_workspace_members" ADD CONSTRAINT "gen2_workspace_members_workspace_id_gen2_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."gen2_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gen2_workspace_members" ADD CONSTRAINT "gen2_workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD CONSTRAINT "gen2_workspaces_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gen2_workspace_members_user_idx" ON "gen2_workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "gen2_workspaces_owner_idx" ON "gen2_workspaces" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gen2_workspaces_share_token_hash_idx" ON "gen2_workspaces" USING btree ("share_token_hash");