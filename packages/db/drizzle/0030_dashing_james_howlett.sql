CREATE TYPE "public"."channel_message_author_kind" AS ENUM('member', 'agent', 'system');--> statement-breakpoint
CREATE TABLE "workspace_channel_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"author_kind" "channel_message_author_kind" DEFAULT 'member' NOT NULL,
	"author_id" uuid,
	"author_label" text,
	"agent_session_id" uuid,
	"body" text NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mentions_agent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_channel_reads" (
	"channel_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_channel_reads_channel_id_user_id_pk" PRIMARY KEY("channel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"topic" text,
	"agent_access" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_member_statuses" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" text,
	"headline" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_member_statuses_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "workspace_channel_messages" ADD CONSTRAINT "workspace_channel_messages_channel_id_workspace_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."workspace_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_channel_messages" ADD CONSTRAINT "workspace_channel_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_channel_messages" ADD CONSTRAINT "workspace_channel_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_channel_messages" ADD CONSTRAINT "workspace_channel_messages_agent_session_id_agent_sessions_id_fk" FOREIGN KEY ("agent_session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_channel_reads" ADD CONSTRAINT "workspace_channel_reads_channel_id_workspace_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."workspace_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_channel_reads" ADD CONSTRAINT "workspace_channel_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_channels" ADD CONSTRAINT "workspace_channels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_channels" ADD CONSTRAINT "workspace_channels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member_statuses" ADD CONSTRAINT "workspace_member_statuses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member_statuses" ADD CONSTRAINT "workspace_member_statuses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_channel_messages_channel_idx" ON "workspace_channel_messages" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "workspace_channel_messages_workspace_idx" ON "workspace_channel_messages" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "workspace_channel_reads_user_idx" ON "workspace_channel_reads" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_channels_workspace_slug_idx" ON "workspace_channels" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "workspace_channels_workspace_idx" ON "workspace_channels" USING btree ("workspace_id","archived_at");--> statement-breakpoint
CREATE INDEX "workspace_member_statuses_workspace_idx" ON "workspace_member_statuses" USING btree ("workspace_id");