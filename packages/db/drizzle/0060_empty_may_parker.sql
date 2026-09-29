CREATE TABLE "provider_credential_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credential_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"surface" text NOT NULL,
	"ref" text NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_credential_runs" ADD CONSTRAINT "provider_credential_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_credential_runs_credential_idx" ON "provider_credential_runs" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "provider_credential_runs_ref_idx" ON "provider_credential_runs" USING btree ("ref");--> statement-breakpoint
ALTER TABLE "provider_credentials" DROP COLUMN "unavailable_until";