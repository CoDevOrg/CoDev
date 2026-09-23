DROP INDEX "gen2_workspaces_share_token_hash_idx";--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD COLUMN "active_invite_token_hash" text;--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD COLUMN "active_invite_created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD COLUMN "active_invite_role" "gen2_workspace_role";--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD COLUMN "active_invite_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD COLUMN "active_invite_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD CONSTRAINT "gen2_workspaces_active_invite_created_by_user_id_users_id_fk" FOREIGN KEY ("active_invite_created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gen2_workspaces_active_invite_token_hash_idx" ON "gen2_workspaces" USING btree ("active_invite_token_hash");--> statement-breakpoint
ALTER TABLE "gen2_workspaces" DROP COLUMN "share_token_hash";