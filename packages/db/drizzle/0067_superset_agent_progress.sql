ALTER TABLE "gen2_superset_runs" ADD COLUMN IF NOT EXISTS "progress_output" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "gen2_superset_runs" ADD COLUMN IF NOT EXISTS "progress_sequence" integer DEFAULT 0 NOT NULL;
