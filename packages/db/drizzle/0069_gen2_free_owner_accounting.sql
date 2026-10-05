CREATE TABLE "gen2_free_compute_claims" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gen2_owner_budgets" (
	"owner_id" uuid NOT NULL,
	"month" timestamp with time zone NOT NULL,
	"compute_cents" integer NOT NULL,
	"storage_cents" integer NOT NULL,
	"network_cents" integer NOT NULL,
	"operations_cents" integer NOT NULL,
	"other_cents" integer NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gen2_owner_budgets_owner_id_month_pk" PRIMARY KEY("owner_id","month"),
	CONSTRAINT "gen2_owner_budgets_nonnegative" CHECK ("gen2_owner_budgets"."compute_cents" >= 0 AND "gen2_owner_budgets"."storage_cents" >= 0 AND "gen2_owner_budgets"."network_cents" >= 0 AND "gen2_owner_budgets"."operations_cents" >= 0 AND "gen2_owner_budgets"."other_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "gen2_compute_sessions" ADD COLUMN "last_observed_allocated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gen2_free_compute_claims" ADD CONSTRAINT "gen2_free_compute_claims_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gen2_free_compute_claims" ADD CONSTRAINT "gen2_free_compute_claims_workspace_id_gen2_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."gen2_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gen2_owner_budgets" ADD CONSTRAINT "gen2_owner_budgets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;