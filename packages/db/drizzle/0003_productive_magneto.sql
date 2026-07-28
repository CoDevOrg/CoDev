CREATE TYPE "public"."sandbox_runtime_status" AS ENUM('provisioning', 'ready', 'stopping', 'stopped', 'failed');--> statement-breakpoint
CREATE TABLE "workspace_runtimes" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" text,
	"backend" text DEFAULT 'firecracker' NOT NULL,
	"status" "sandbox_runtime_status" DEFAULT 'provisioning' NOT NULL,
	"last_error" text,
	"provisioned_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_runtimes_sandbox_id_unique" UNIQUE("sandbox_id")
);
--> statement-breakpoint
ALTER TABLE "workspace_runtimes" ADD CONSTRAINT "workspace_runtimes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_runtimes_status_updated_idx" ON "workspace_runtimes" USING btree ("status","updated_at");--> statement-breakpoint
ALTER TABLE "public"."workspace_runtimes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "public"."workspace_runtimes" FROM "anon";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."workspace_runtimes" FROM "authenticated";
