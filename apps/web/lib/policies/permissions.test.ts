import { describe, expect, it } from "vitest";
import type { Gen2WorkspaceRole } from "@codev/contracts";

import {
  hasWorkspacePermission,
  permissionsForWorkspaceRole,
  workspacePermissionNames,
  type WorkspacePermission,
} from "./permissions";

const grantedForRole: Record<
  Gen2WorkspaceRole,
  readonly WorkspacePermission[]
> = {
  owner: workspacePermissionNames,
  editor: [
    "workspace.view",
    "workspace.editFiles",
    "workspace.useTerminal",
    "agent.run",
    "agent.cancelOwn",
    "context.view",
    "context.includeInTurn",
    "connection.manageOwn",
    "connection.viewStatus",
  ],
  viewer: ["workspace.view", "context.view", "connection.viewStatus"],
};

describe("workspace role permissions", () => {
  it.each(["owner", "editor", "viewer"] as const)(
    "resolves the complete permission matrix for %s",
    (role) => {
      const capabilities = permissionsForWorkspaceRole(role);

      expect(capabilities).toEqual(
        Object.fromEntries(
          workspacePermissionNames.map((permission) => [
            permission,
            grantedForRole[role].includes(permission),
          ]),
        ),
      );
    },
  );

  it("keeps role presets out of capability checks", () => {
    const editorCapabilities = permissionsForWorkspaceRole("editor");

    expect(
      hasWorkspacePermission(editorCapabilities, "workspace.editFiles"),
    ).toBe(true);
    expect(
      hasWorkspacePermission(editorCapabilities, "member.changeRole"),
    ).toBe(false);
  });

  it("returns fresh capability flags for every lookup", () => {
    const first = permissionsForWorkspaceRole("viewer");
    const second = permissionsForWorkspaceRole("viewer");

    first["workspace.view"] = false;
    expect(second["workspace.view"]).toBe(true);
  });
});
