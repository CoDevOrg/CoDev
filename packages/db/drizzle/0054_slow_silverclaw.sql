CREATE TYPE "public"."gen2_provider" AS ENUM('openai', 'anthropic', 'cursor');--> statement-breakpoint
ALTER TABLE "gen2_agent_turns" ADD COLUMN "provider" "gen2_provider" DEFAULT 'openai' NOT NULL;--> statement-breakpoint
ALTER TABLE "gen2_chat_messages" ADD COLUMN "provider" "gen2_provider";--> statement-breakpoint
ALTER TABLE "gen2_chats" ADD COLUMN "default_provider" "gen2_provider" DEFAULT 'openai' NOT NULL;