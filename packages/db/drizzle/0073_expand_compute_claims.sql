ALTER TABLE "gen2_free_compute_claims" DROP CONSTRAINT "gen2_free_compute_claims_pkey";--> statement-breakpoint
ALTER TABLE "gen2_free_compute_claims" ADD CONSTRAINT "gen2_free_compute_claims_owner_id_workspace_id_pk" PRIMARY KEY("owner_id","workspace_id");
