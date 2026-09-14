import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../drizzle/0044_cute_christian_walker.sql", import.meta.url),
);
const migration = readFileSync(migrationPath, "utf8");

describe("organization bootstrap migration", () => {
  it("backfills every workspace before requiring an organization", () => {
    const createOrganizations = migration.indexOf(
      'INSERT INTO "organizations"',
    );
    const attachWorkspaces = migration.indexOf('UPDATE "workspaces"');
    const requireOrganization = migration.indexOf(
      'ALTER TABLE "workspaces" ALTER COLUMN "organization_id" SET NOT NULL',
    );

    expect(createOrganizations).toBeGreaterThanOrEqual(0);
    expect(attachWorkspaces).toBeGreaterThan(createOrganizations);
    expect(requireOrganization).toBeGreaterThan(attachWorkspaces);
  });

  it("preserves workspace roles while bootstrapping memberships", () => {
    expect(migration).toContain('INSERT INTO "organization_members"');
    expect(migration).toContain("'owner'::\"organization_role\"");
    expect(migration).toContain("'member'::\"organization_role\"");
    expect(migration).not.toContain('UPDATE "workspace_members"');
  });

  it("assigns a free active subscription without replacing existing rows", () => {
    expect(migration).toContain('INSERT INTO "organization_subscriptions"');
    expect(migration).toContain("'free'::\"subscription_plan\"");
    expect(migration).toContain(
      "'active'::\"organization_subscription_status\"",
    );
    expect(migration).toContain('ON CONFLICT ("organization_id") DO NOTHING');
  });
});
