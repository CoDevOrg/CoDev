ALTER TABLE "gen2_yjs_documents" ADD COLUMN "worktree_id" text DEFAULT 'main' NOT NULL;
--> statement-breakpoint
DROP INDEX "gen2_yjs_documents_workspace_path_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "gen2_yjs_documents_workspace_worktree_path_idx" ON "gen2_yjs_documents" USING btree ("workspace_id","worktree_id","path");
