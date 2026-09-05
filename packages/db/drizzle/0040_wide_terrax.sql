ALTER TABLE "workspaces" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "workspaces_deleted_idx" ON "workspaces" USING btree ("deleted_at");