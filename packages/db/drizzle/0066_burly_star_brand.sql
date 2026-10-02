CREATE TABLE "gen2_compute_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "gen2_compute_sessions" ADD CONSTRAINT "gen2_compute_sessions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gen2_compute_sessions_owner_start_idx" ON "gen2_compute_sessions" USING btree ("owner_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gen2_compute_sessions_active_workspace_idx" ON "gen2_compute_sessions" USING btree ("workspace_id") WHERE "gen2_compute_sessions"."ended_at" IS NULL;