-- Bootstrap one deterministic personal organization per existing user. Reusing
-- the user UUID makes the migration easy to join and safe to resume.
INSERT INTO "organizations" ("id", "slug", "name")
SELECT
	"id",
	'personal-' || replace("id"::text, '-', ''),
	COALESCE(NULLIF(BTRIM("name"), ''), "login") || '''s organization'
FROM "users"
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "organization_members" ("organization_id", "user_id", "role")
SELECT "id", "id", 'owner'::"organization_role"
FROM "users"
ON CONFLICT ("organization_id", "user_id") DO NOTHING;--> statement-breakpoint

-- A workspace belongs to its existing owner's personal organization. This does
-- not alter workspace_members or any current workspace permission.
UPDATE "workspaces"
SET "organization_id" = "owner_id"
WHERE "organization_id" IS NULL;--> statement-breakpoint

-- Existing workspace collaborators become ordinary organization members. Their
-- finer-grained co-steer/reviewer/viewer access remains on workspace_members.
INSERT INTO "organization_members" ("organization_id", "user_id", "role")
SELECT DISTINCT
	"workspaces"."organization_id",
	"workspace_members"."user_id",
	CASE
		WHEN "workspace_members"."user_id" = "workspaces"."owner_id"
			THEN 'owner'::"organization_role"
		ELSE 'member'::"organization_role"
	END
FROM "workspace_members"
INNER JOIN "workspaces"
	ON "workspaces"."id" = "workspace_members"."workspace_id"
ON CONFLICT ("organization_id", "user_id") DO NOTHING;--> statement-breakpoint

INSERT INTO "organization_subscriptions" (
	"organization_id",
	"plan_id",
	"status"
)
SELECT "id", 'free'::"subscription_plan", 'active'::"organization_subscription_status"
FROM "organizations"
ON CONFLICT ("organization_id") DO NOTHING;--> statement-breakpoint

ALTER TABLE "workspaces" ALTER COLUMN "organization_id" SET NOT NULL;
