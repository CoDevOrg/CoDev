CREATE TYPE "public"."runtime_host_lifecycle" AS ENUM('provisioning', 'ready', 'draining', 'stopped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."workspace_runtime_assignment_state" AS ENUM('assigned', 'starting', 'ready', 'draining', 'lost');--> statement-breakpoint
CREATE TABLE "runtime_hosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" text NOT NULL,
	"runtime_address" text NOT NULL,
	"lifecycle_state" "runtime_host_lifecycle" DEFAULT 'provisioning' NOT NULL,
	"max_workspace_slots" integer DEFAULT 4 NOT NULL,
	"free_workspace_slots" integer DEFAULT 4 NOT NULL,
	"image_version" text,
	"last_heartbeat_at" timestamp with time zone,
	"draining_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_runtime_assignments" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"host_id" uuid NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"fencing_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"disk_id" text,
	"runtime_state" "workspace_runtime_assignment_state" DEFAULT 'assigned' NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_runtime_assignments" ADD CONSTRAINT "workspace_runtime_assignments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_runtime_assignments" ADD CONSTRAINT "workspace_runtime_assignments_host_id_runtime_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."runtime_hosts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_hosts_provider_id_idx" ON "runtime_hosts" USING btree ("provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_hosts_runtime_address_idx" ON "runtime_hosts" USING btree ("runtime_address");--> statement-breakpoint
CREATE INDEX "runtime_hosts_capacity_idx" ON "runtime_hosts" USING btree ("lifecycle_state","free_workspace_slots");--> statement-breakpoint
CREATE INDEX "workspace_runtime_assignments_host_state_idx" ON "workspace_runtime_assignments" USING btree ("host_id","runtime_state");--> statement-breakpoint
CREATE INDEX "workspace_runtime_assignments_state_updated_idx" ON "workspace_runtime_assignments" USING btree ("runtime_state","updated_at");