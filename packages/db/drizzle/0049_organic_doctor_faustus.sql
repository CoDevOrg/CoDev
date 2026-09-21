CREATE TABLE "gen2_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"role" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gen2_chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gen2_chat_messages" ADD CONSTRAINT "gen2_chat_messages_chat_id_gen2_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."gen2_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gen2_chats" ADD CONSTRAINT "gen2_chats_workspace_id_gen2_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."gen2_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gen2_chats" ADD CONSTRAINT "gen2_chats_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gen2_chat_messages_chat_idx" ON "gen2_chat_messages" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "gen2_chats_workspace_updated_idx" ON "gen2_chats" USING btree ("workspace_id","updated_at");