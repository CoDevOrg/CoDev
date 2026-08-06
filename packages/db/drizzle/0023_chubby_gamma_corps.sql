CREATE TABLE "sandbox_runtime_intervals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_compute_usage" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"minutes_used" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sandbox_runtime_intervals" ADD CONSTRAINT "sandbox_runtime_intervals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_runtime_intervals" ADD CONSTRAINT "sandbox_runtime_intervals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_compute_usage" ADD CONSTRAINT "user_compute_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sandbox_runtime_intervals_user_open_idx" ON "sandbox_runtime_intervals" USING btree ("user_id","ended_at");--> statement-breakpoint
CREATE INDEX "sandbox_runtime_intervals_workspace_open_idx" ON "sandbox_runtime_intervals" USING btree ("workspace_id","ended_at");