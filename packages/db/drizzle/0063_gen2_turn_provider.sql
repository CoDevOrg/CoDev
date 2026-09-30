-- Turn rows are scratch space for streaming output; the reply that matters is
-- already in gen2_chat_messages. Clearing them lets the column be NOT NULL
-- with no default, so no provider is ever assumed for a turn.
DELETE FROM "gen2_agent_turns";--> statement-breakpoint
ALTER TABLE "gen2_agent_turns" ADD COLUMN "provider" text NOT NULL;
