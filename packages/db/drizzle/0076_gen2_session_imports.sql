CREATE TABLE "gen2_session_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"imported_by_user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"native_session_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"chat_id" uuid,
	"encrypted_payload" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"payload_bytes" integer NOT NULL,
	"meta" jsonb NOT NULL,
	"guest_synced_generation" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gen2_session_imports" ADD CONSTRAINT "gen2_session_imports_workspace_id_gen2_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."gen2_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gen2_session_imports" ADD CONSTRAINT "gen2_session_imports_imported_by_user_id_users_id_fk" FOREIGN KEY ("imported_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gen2_session_imports" ADD CONSTRAINT "gen2_session_imports_chat_id_gen2_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."gen2_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gen2_session_imports_chat_idx" ON "gen2_session_imports" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "gen2_session_imports_user_status_idx" ON "gen2_session_imports" USING btree ("imported_by_user_id","status","created_at");