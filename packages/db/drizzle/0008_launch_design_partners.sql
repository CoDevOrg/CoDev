CREATE TABLE "design_partner_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid,
	"category" text NOT NULL,
	"rating" integer,
	"message" text NOT NULL,
	"page" text,
	"release" text,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "repository_visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "design_partner_feedback" ADD CONSTRAINT "design_partner_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_partner_feedback" ADD CONSTRAINT "design_partner_feedback_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_partner_feedback_user_created_idx" ON "design_partner_feedback" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "design_partner_feedback_status_created_idx" ON "design_partner_feedback" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "design_partner_feedback"
ADD CONSTRAINT "design_partner_feedback_rating_check"
CHECK ("rating" IS NULL OR ("rating" >= 1 AND "rating" <= 5));--> statement-breakpoint
ALTER TABLE "design_partner_feedback"
ADD CONSTRAINT "design_partner_feedback_category_check"
CHECK ("category" IN ('bug', 'workflow', 'feature', 'other'));--> statement-breakpoint
ALTER TABLE "design_partner_feedback" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "design_partner_feedback" FROM anon, authenticated;
