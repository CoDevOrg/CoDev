import { getTableName } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import {
  ensurePersonalOrganization,
  personalOrganizationName,
  personalOrganizationSlug,
} from "./organization-bootstrap";

describe("personal organization bootstrap", () => {
  it("builds deterministic identity values", () => {
    expect(personalOrganizationSlug("a-b-c")).toBe("personal-abc");
    expect(personalOrganizationName({ name: " Ada ", login: "ada" })).toBe(
      "Ada's organization",
    );
    expect(personalOrganizationName({ name: null, login: "ada" })).toBe(
      "ada's organization",
    );
  });

  it("creates the organization, owner membership, and free subscription", async () => {
    const inserted: Array<{ table: string; values: unknown }> = [];
    const selectQuery = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(),
    };
    selectQuery.from.mockReturnValue(selectQuery);
    selectQuery.where.mockReturnValue(selectQuery);
    selectQuery.limit.mockResolvedValue([
      { id: "user-1", login: "ada", name: "Ada" },
    ]);
    const transaction = {
      select: vi.fn(() => selectQuery),
      insert: vi.fn((table: Parameters<typeof getTableName>[0]) => ({
        values: (values: unknown) => {
          inserted.push({ table: getTableName(table), values });
          return { onConflictDoNothing: vi.fn().mockResolvedValue(undefined) };
        },
      })),
    };

    await expect(
      ensurePersonalOrganization(transaction as never, "user-1"),
    ).resolves.toBe("user-1");
    expect(inserted).toEqual([
      {
        table: "organizations",
        values: {
          id: "user-1",
          slug: "personal-user1",
          name: "Ada's organization",
        },
      },
      {
        table: "organization_members",
        values: {
          organizationId: "user-1",
          userId: "user-1",
          role: "owner",
        },
      },
      {
        table: "organization_subscriptions",
        values: {
          organizationId: "user-1",
          planId: "free",
          status: "active",
        },
      },
    ]);
  });

  it("fails before writing when the user does not exist", async () => {
    const selectQuery = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn().mockResolvedValue([]),
    };
    selectQuery.from.mockReturnValue(selectQuery);
    selectQuery.where.mockReturnValue(selectQuery);
    const transaction = {
      select: vi.fn(() => selectQuery),
      insert: vi.fn(),
    };

    await expect(
      ensurePersonalOrganization(transaction as never, "missing"),
    ).rejects.toThrow("Cannot create an organization for this user.");
    expect(transaction.insert).not.toHaveBeenCalled();
  });
});
