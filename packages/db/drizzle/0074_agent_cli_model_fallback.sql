CREATE TABLE "agent_cli_model_requirements" (
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"min_version" text NOT NULL,
	"observed_version" text NOT NULL,
	"image_version_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_cli_model_requirements_provider_model_pk" PRIMARY KEY("provider","model")
);
--> statement-breakpoint
ALTER TABLE "gen2_agent_turns" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "gen2_agent_turns" ADD COLUMN "worktree_id" text;--> statement-breakpoint
ALTER TABLE "gen2_agent_turns" ADD COLUMN "continued_as_session_id" text;