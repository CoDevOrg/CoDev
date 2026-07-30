ALTER TABLE "workspace_runtimes" ADD COLUMN "provisioned_head_sha" text;
--> statement-breakpoint
UPDATE "workspace_runtimes" AS "runtime"
SET "provisioned_head_sha" = "worktree"."head_sha"
FROM "worktrees" AS "worktree"
WHERE "runtime"."workspace_id" = "worktree"."workspace_id"
  AND "runtime"."status" = 'ready'
  AND "worktree"."kind" = 'integration';
