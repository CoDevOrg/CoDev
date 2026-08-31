CREATE TYPE "public"."agent_session_kind" AS ENUM('managed', 'cli');--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "kind" "agent_session_kind" DEFAULT 'managed' NOT NULL;