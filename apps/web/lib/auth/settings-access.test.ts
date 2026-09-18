import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkOrgSettingsAccess,
  isOrganizationSettingsAdmin,
} from "./settings-access";

const mocks = vi.hoisted(() => ({
  requireWorkspacePermission: vi.fn(),
  checkWorkspaceRelation: vi.fn(),
}));

vi.mock("./access", () => ({
  checkWorkspaceRelation: mocks.checkWorkspaceRelation,
  requireWorkspacePermission: mocks.requireWorkspacePermission,
  WorkspaceAccessError: class WorkspaceAccessError extends Error {
    status = 403;
  },
}));

afterEach(() => {
  mocks.requireWorkspacePermission.mockReset();
  mocks.checkWorkspaceRelation.mockReset();
});

describe("organization settings access", () => {
  it("maps only maintainers to organization Admins", () => {
    expect(isOrganizationSettingsAdmin("owner")).toBe(true);
    expect(isOrganizationSettingsAdmin("co_steer")).toBe(false);
    expect(isOrganizationSettingsAdmin("reviewer")).toBe(false);
    expect(isOrganizationSettingsAdmin("viewer")).toBe(false);
  });

  it("allows a Maintainer write only when OpenFGA confirms owner access", async () => {
    mocks.requireWorkspacePermission.mockResolvedValue({ role: "owner" });
    mocks.checkWorkspaceRelation.mockResolvedValue(true);

    await expect(
      checkOrgSettingsAccess("user-1", "workspace-1", "write"),
    ).resolves.toMatchObject({ role: "owner", canWrite: true });
    expect(mocks.checkWorkspaceRelation).toHaveBeenCalledWith(
      "workspace-1",
      "user-1",
      "owner",
    );
  });

  it("keeps reviewer and viewer members read-only", async () => {
    mocks.requireWorkspacePermission.mockResolvedValue({ role: "reviewer" });

    await expect(
      checkOrgSettingsAccess("user-1", "workspace-1", "write"),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.checkWorkspaceRelation).not.toHaveBeenCalled();
  });

  it("checks the owner relationship for Owner writes", async () => {
    mocks.requireWorkspacePermission.mockResolvedValue({ role: "owner" });
    mocks.checkWorkspaceRelation.mockResolvedValue(true);

    await expect(
      checkOrgSettingsAccess("user-1", "workspace-1", "write"),
    ).resolves.toMatchObject({ role: "owner", canWrite: true });
    expect(mocks.checkWorkspaceRelation).toHaveBeenCalledWith(
      "workspace-1",
      "user-1",
      "owner",
    );
  });
});
