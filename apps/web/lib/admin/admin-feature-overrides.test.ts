import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    selections: [] as unknown[][],
    inserts: [] as Array<{ table: unknown; values: unknown }>,
    deletes: [] as unknown[],
  };
  const transaction = {
    select: vi.fn(() => {
      const rows = state.selections.shift() ?? [];
      const query = {
        from: vi.fn(),
        where: vi.fn(),
        limit: vi.fn(async () => rows),
      };
      query.from.mockReturnValue(query);
      query.where.mockReturnValue(query);
      return query;
    }),
    insert: vi.fn((table: unknown) => ({
      values: (values: unknown) => {
        state.inserts.push({ table, values });
        return { onConflictDoUpdate: vi.fn(async () => undefined) };
      },
    })),
    delete: vi.fn((table: unknown) => ({
      where: vi.fn(async () => {
        state.deletes.push(table);
      }),
    })),
  };
  return { ...state, transaction };
});

vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    transaction: (run: (transaction: unknown) => Promise<unknown>) =>
      run(mocks.transaction),
  }),
}));

import { schema } from "@codev/db";

import {
  setOrganizationFeatureOverride,
  setUserFeatureOverride,
} from "./admin-feature-access";

const input = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  feature: "hosted_codex_subscription" as const,
  actorUserId: "33333333-3333-4333-8333-333333333333",
};

beforeEach(() => {
  mocks.selections.length = 0;
  mocks.inserts.length = 0;
  mocks.deletes.length = 0;
});

describe("admin feature override actions", () => {
  it("saves organization access and records who changed it", async () => {
    mocks.selections.push([{ id: input.organizationId }], []);
    await setOrganizationFeatureOverride({
      ...input,
      state: "enabled",
      expiresAt: null,
    });

    expect(mocks.inserts[0]).toMatchObject({
      table: schema.organizationFeatureOverrides,
      values: {
        organizationId: input.organizationId,
        feature: input.feature,
        enabled: true,
        expiresAt: null,
        createdBy: input.actorUserId,
      },
    });
    expect(mocks.inserts[1]).toMatchObject({
      table: schema.featureOverrideAuditEvents,
      values: { action: "created", enabled: true },
    });
  });

  it("removes an organization override to restore inherited access", async () => {
    mocks.selections.push(
      [{ id: input.organizationId }],
      [{ enabled: false, expiresAt: null }],
    );
    await setOrganizationFeatureOverride({
      ...input,
      state: "inherit",
      expiresAt: null,
    });

    expect(mocks.deletes).toContain(schema.organizationFeatureOverrides);
    expect(mocks.inserts[0]).toMatchObject({
      table: schema.featureOverrideAuditEvents,
      values: {
        action: "deleted",
        previousEnabled: false,
        enabled: null,
      },
    });
  });

  it("saves member access only when the member belongs to that organization", async () => {
    mocks.selections.push([{ userId: input.userId }], []);
    await setUserFeatureOverride({
      ...input,
      state: "disabled",
      expiresAt: null,
    });

    expect(mocks.inserts[0]).toMatchObject({
      table: schema.userFeatureOverrides,
      values: {
        organizationId: input.organizationId,
        userId: input.userId,
        feature: input.feature,
        enabled: false,
        createdBy: input.actorUserId,
      },
    });
    expect(mocks.inserts[1]).toMatchObject({
      table: schema.featureOverrideAuditEvents,
      values: { targetUserId: input.userId, action: "created" },
    });
  });

  it("removes a member override and records the inherited state", async () => {
    mocks.selections.push(
      [{ userId: input.userId }],
      [{ enabled: true, expiresAt: null }],
    );
    await setUserFeatureOverride({
      ...input,
      state: "inherit",
      expiresAt: null,
    });

    expect(mocks.deletes).toContain(schema.userFeatureOverrides);
    expect(mocks.inserts[0]).toMatchObject({
      table: schema.featureOverrideAuditEvents,
      values: {
        organizationId: input.organizationId,
        targetUserId: input.userId,
        action: "deleted",
        previousEnabled: true,
        enabled: null,
      },
    });
  });
});
