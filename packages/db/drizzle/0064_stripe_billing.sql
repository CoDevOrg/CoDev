CREATE TABLE "stripe_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_subscriptions" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- The $20/month Individual plan is the existing "pro" plan; only its display
-- name changes, so the subscription_plan enum stays as it is.
UPDATE "plans" SET "name" = 'Individual', "updated_at" = now() WHERE "id" = 'pro';
