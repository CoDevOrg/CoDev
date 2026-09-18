import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertWorkspaceQuota: vi.fn(),
  ensurePersonalOrganization: vi.fn(),
  getRepository: vi.fn(),
  inserted: [] as Array<{ table: string; values: Record<string, unknown> }>,
  writeWorkspaceTuple: vi.fn(),
}));

vi.mock("./audit", () => ({ appendWorkspaceEvent: vi.fn() }));
vi.mock("../auth/access", () => ({
  getWorkspaceAccess: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  WorkspaceAccessError: class WorkspaceAccessError extends Error {},
  writeWorkspaceTuple: mocks.writeWorkspaceTuple,
}));
vi.mock("../platform/crypto", () => ({
  createInviteToken: vi.fn(),
  hashInviteToken: vi.fn(),
}));
vi.mock("../github/github", () => ({ getRepository: mocks.getRepository }));
vi.mock("../admin/organization-bootstrap", () => ({
  ensurePersonalOrganization: mocks.ensurePersonalOrganization,
}));
vi.mock("../auth/settings-access", () => ({
  requireOrganizationSettingsWrite: vi.fn(),
}));
vi.mock("../runtime/quotas", () => ({
  assertWorkspaceQuota: mocks.assertWorkspaceQuota,
}));
vi.mock("../runtime/vm-usage", () => ({
  closeSandboxInterval: vi.fn(),
  openSandboxInterval: vi.fn(),
}));
vi.mock("./workspace-lifecycle", () => ({
  hasUnpublishedRuntimeChanges: vi.fn(),
  workspaceSyncBlockReason: vi.fn(),
}));
vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    transaction: async (callback: (transaction: unknown) => unknown) => {
      const transaction = {
        insert: (table: Parameters<typeof getTableName>[0]) => ({
          values: (values: Record<string, unknown>) => {
            const tableName = getTableName(table);
            mocks.inserted.push({ table: tableName, values });
            if (tableName === "workspaces") {
              return {
                returning: async () => [{ id: "workspace-1", ...values }],
              };
            }
            return Promise.resolve();
          },
        }),
      };
      return callback(transaction);
    },
  }),
}));

import { createWorkspace } from "./workspaces";

describe("workspace organization bootstrap", () => {
  beforeEach(() => {
    mocks.inserted.length = 0;
    mocks.assertWorkspaceQuota.mockReset();
    mocks.ensurePersonalOrganization.mockReset();
    mocks.ensurePersonalOrganization.mockResolvedValue("organization-1");
    mocks.writeWorkspaceTuple.mockReset();
  });

  it("attaches a new workspace to the owner's personal organization", async () => {
    await expect(createWorkspace("user-1")).resolves.toMatchObject({
      id: "workspace-1",
      organizationId: "organization-1",
    });

    expect(mocks.ensurePersonalOrganization).toHaveBeenCalledWith(
      expect.any(Object),
      "user-1",
    );
    expect(mocks.inserted[0]).toMatchObject({
      table: "workspaces",
      values: {
        ownerId: "user-1",
        organizationId: "organization-1",
      },
    });
    expect(mocks.writeWorkspaceTuple).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userId: "user-1",
      role: "owner",
    });
  });
});
