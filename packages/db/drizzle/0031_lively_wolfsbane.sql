CREATE TABLE "workspace_chat_leases" (
	"workspace_id" uuid NOT NULL,
	"chat_id" text NOT NULL,
	"holder_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"lease_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_chat_leases_workspace_id_chat_id_pk" PRIMARY KEY("workspace_id","chat_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_chat_participants" (
	"workspace_id" uuid NOT NULL,
	"chat_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_chat_participants_workspace_id_chat_id_user_id_client_id_pk" PRIMARY KEY("workspace_id","chat_id","user_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_chat_prompt_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"chat_id" text NOT NULL,
	"author_id" uuid NOT NULL,
	"client_message_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"effort" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_chat_leases" ADD CONSTRAINT "workspace_chat_leases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_chat_leases" ADD CONSTRAINT "workspace_chat_leases_holder_id_users_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_chat_participants" ADD CONSTRAINT "workspace_chat_participants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_chat_participants" ADD CONSTRAINT "workspace_chat_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_chat_prompt_receipts" ADD CONSTRAINT "workspace_chat_prompt_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_chat_prompt_receipts" ADD CONSTRAINT "workspace_chat_prompt_receipts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_chat_leases_expiry_idx" ON "workspace_chat_leases" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "workspace_chat_participants_expiry_idx" ON "workspace_chat_participants" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_chat_prompt_receipts_client_message_idx" ON "workspace_chat_prompt_receipts" USING btree ("workspace_id","chat_id","client_message_id");--> statement-breakpoint
CREATE INDEX "workspace_chat_prompt_receipts_chat_created_idx" ON "workspace_chat_prompt_receipts" USING btree ("workspace_id","chat_id","created_at");