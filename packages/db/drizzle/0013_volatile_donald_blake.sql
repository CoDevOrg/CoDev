CREATE TABLE "workspace_snapshots" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"head_sha" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"total_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_snapshots" ADD CONSTRAINT "workspace_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_snapshots_updated_idx" ON "workspace_snapshots" USING btree ("updated_at");