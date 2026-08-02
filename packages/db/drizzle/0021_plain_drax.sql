ALTER TABLE "users" ADD COLUMN "google_user_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_user_id_idx" ON "users" USING btree ("google_user_id");