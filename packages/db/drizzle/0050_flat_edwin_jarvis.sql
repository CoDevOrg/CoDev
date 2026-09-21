CREATE TABLE "gen2_agent_turns" (
	"session_id" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"output" text DEFAULT '' NOT NULL,
	"pending_base64" text DEFAULT '' NOT NULL,
	"exited" boolean DEFAULT false NOT NULL,
	"reply_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gen2_chat_messages" ADD COLUMN "items" jsonb;--> statement-breakpoint
ALTER TABLE "gen2_agent_turns" ADD CONSTRAINT "gen2_agent_turns_workspace_id_gen2_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."gen2_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gen2_agent_turns" ADD CONSTRAINT "gen2_agent_turns_chat_id_gen2_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."gen2_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gen2_agent_turns" ADD CONSTRAINT "gen2_agent_turns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gen2_agent_turns" ADD CONSTRAINT "gen2_agent_turns_reply_message_id_gen2_chat_messages_id_fk" FOREIGN KEY ("reply_message_id") REFERENCES "public"."gen2_chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gen2_agent_turns_chat_idx" ON "gen2_agent_turns" USING btree ("chat_id","created_at");