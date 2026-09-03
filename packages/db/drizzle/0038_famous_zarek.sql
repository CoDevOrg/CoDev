CREATE TABLE "shared_chat_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shared_chat_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shared_chat_invites" ADD CONSTRAINT "shared_chat_invites_shared_chat_id_shared_chats_id_fk" FOREIGN KEY ("shared_chat_id") REFERENCES "public"."shared_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_chat_invites" ADD CONSTRAINT "shared_chat_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_chat_invites" ADD CONSTRAINT "shared_chat_invites_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shared_chat_invites_token_hash_idx" ON "shared_chat_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "shared_chat_invites_room_idx" ON "shared_chat_invites" USING btree ("shared_chat_id");