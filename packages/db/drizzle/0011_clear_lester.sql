ALTER TABLE "published_branches" ADD COLUMN IF NOT EXISTS "pull_request_number" integer;--> statement-breakpoint
ALTER TABLE "published_branches" ADD COLUMN IF NOT EXISTS "pull_request_url" text;
