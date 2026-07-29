ALTER TABLE "yjs_snapshots" ADD COLUMN "state_vector_base64" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "yjs_snapshots" ADD COLUMN "filesystem_contents" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "yjs_snapshots" ADD COLUMN "filesystem_revision" text;--> statement-breakpoint
ALTER TABLE "yjs_snapshots" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "yjs_snapshots" ADD COLUMN "has_conflict" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "yjs_snapshots" ADD COLUMN "conflict_filesystem_revision" text;