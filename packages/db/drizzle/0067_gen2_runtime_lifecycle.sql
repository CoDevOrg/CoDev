CREATE TYPE "public"."gen2_runtime_operation_kind" AS ENUM('start', 'stop', 'delete');--> statement-breakpoint
CREATE TYPE "public"."gen2_runtime_provider" AS ENUM('firecracker', 'azure_arm');--> statement-breakpoint
CREATE TYPE "public"."gen2_runtime_status" AS ENUM('stopped', 'queued', 'provisioning', 'booting', 'attaching_disk', 'starting_tunnel', 'checking_readiness', 'ready', 'stopping', 'failed');--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD COLUMN "runtime_provider" "gen2_runtime_provider" DEFAULT 'firecracker' NOT NULL;--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD COLUMN "runtime_vm_resource_id" text;--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD COLUMN "runtime_disk_resource_id" text;--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD COLUMN "runtime_disk_uuid" text;--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD COLUMN "runtime_tunnel_id" text;--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD COLUMN "runtime_route_host" text;--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD COLUMN "runtime_status" "gen2_runtime_status" DEFAULT 'stopped' NOT NULL;--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD COLUMN "runtime_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD COLUMN "runtime_cleanup_generation" integer;--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD COLUMN "runtime_operation_id" uuid;--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD COLUMN "runtime_operation_key" text;--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD COLUMN "runtime_operation_kind" "gen2_runtime_operation_kind";--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD COLUMN "runtime_operation_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gen2_workspaces" ADD COLUMN "runtime_lease_expires_at" timestamp with time zone;
