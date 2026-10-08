ALTER TABLE "gen2_chats" ADD COLUMN "provider" text;--> statement-breakpoint
UPDATE "gen2_chats" AS "chat"
SET "provider" = "first_turn"."provider"
FROM (
	SELECT DISTINCT ON ("chat_id") "chat_id", "provider"
	FROM "gen2_agent_turns"
	ORDER BY "chat_id", "created_at"
) AS "first_turn"
WHERE "first_turn"."chat_id" = "chat"."id" AND "chat"."provider" IS NULL;
