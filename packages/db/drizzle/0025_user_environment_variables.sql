CREATE TABLE "user_environment_variables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"last_four" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_environment_variables" ADD CONSTRAINT "user_environment_variables_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "user_environment_variables_user_name_idx" ON "user_environment_variables" USING btree ("user_id","name");
--> statement-breakpoint
CREATE INDEX "user_environment_variables_user_updated_idx" ON "user_environment_variables" USING btree ("user_id","updated_at");
