CREATE TABLE "gen2_yjs_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "path" text NOT NULL,
  "revision" text NOT NULL,
  "update_base64" text NOT NULL,
  "state_vector_base64" text DEFAULT '' NOT NULL,
  "filesystem_contents" text DEFAULT '' NOT NULL,
  "filesystem_revision" text,
  "last_synced_at" timestamp with time zone,
  "has_conflict" boolean DEFAULT false NOT NULL,
  "conflict_filesystem_revision" text,
  "conflict_detected_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gen2_yjs_documents" ADD CONSTRAINT "gen2_yjs_documents_workspace_id_gen2_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."gen2_workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "gen2_yjs_documents_workspace_path_idx" ON "gen2_yjs_documents" USING btree ("workspace_id", "path");
