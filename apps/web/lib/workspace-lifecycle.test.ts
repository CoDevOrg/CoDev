import { describe, expect, it } from "vitest";

import {
  hasUnpublishedRuntimeChanges,
  workspaceSyncBlockReason,
} from "./workspace-lifecycle";

describe("workspace lifecycle baselines", () => {
  it("treats an untouched credential-free snapshot as clean", () => {
    expect(
      hasUnpublishedRuntimeChanges(
        "synthetic-private-head",
        "synthetic-private-head",
        "github-base-head",
      ),
    ).toBe(false);
  });

  it("detects changes after the sandbox baseline", () => {
    expect(
      hasUnpublishedRuntimeChanges(
        "edited-head",
        "synthetic-private-head",
        "github-base-head",
      ),
    ).toBe(true);
  });

  it("falls back to the repository base for existing runtimes", () => {
    expect(
      hasUnpublishedRuntimeChanges(
        "github-base-head",
        null,
        "github-base-head",
      ),
    ).toBe(false);
  });
});

describe("workspaceSyncBlockReason", () => {
  it("allows an owner to sync a stopped workspace", () => {
    expect(workspaceSyncBlockReason("owner", "stopped")).toBeNull();
  });

  it("blocks non-owners", () => {
    expect(workspaceSyncBlockReason("collaborator", "stopped")).toBe(
      "not_owner",
    );
  });

  it("blocks syncing while a sandbox is live", () => {
    for (const status of ["ready", "provisioning", "stopping", "failed"]) {
      expect(workspaceSyncBlockReason("owner", status)).toBe("not_stopped");
    }
  });
});
