ALTER TABLE "access_requests" ADD COLUMN "invite_token_hash" text;--> statement-breakpoint
ALTER TABLE "access_requests" ADD COLUMN "invite_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "access_requests" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "access_requests_invite_token_hash_idx" ON "access_requests" USING btree ("invite_token_hash");