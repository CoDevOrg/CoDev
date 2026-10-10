import { describe, expect, it } from "vitest";
import type { Gen2Workspace } from "@codev/contracts";

import {
  formatMinutes,
  formatRelativeTime,
  isWorkspaceSettling,
  workspacePhase,
} from "./workspace-phase";

const base: Gen2Workspace = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Studio",
  repository: null,
  status: "ready",
  sandboxId: null,
  runtimeProvider: "azure_arm",
  runtimeStatus: "ready",
  runtimeGeneration: 1,
  lastError: null,
  role: "owner",
  createdAt: "2026-10-01T12:00:00.000Z",
  updatedAt: "2026-10-01T12:00:00.000Z",
};

const make = (partial: Partial<Gen2Workspace>) => ({ ...base, ...partial });

describe("workspacePhase", () => {
  it("tells a stop apart from a start, which share the provisioning status", () => {
    expect(
      workspacePhase(
        make({ status: "provisioning", runtimeStatus: "stopping" }),
      ),
    ).toBe("stopping");
    expect(
      workspacePhase(
        make({ status: "provisioning", runtimeStatus: "booting" }),
      ),
    ).toBe("starting");
  });

  it("only calls an ARM workspace running once its VM is ready", () => {
    expect(workspacePhase(base)).toBe("running");
    expect(workspacePhase(make({ runtimeStatus: "stopped" }))).toBe("stopped");
    expect(workspacePhase(make({ runtimeStatus: "failed" }))).toBe("failed");
    expect(
      workspacePhase(
        make({ runtimeProvider: "firecracker", runtimeStatus: "stopped" }),
      ),
    ).toBe("running");
  });

  it("maps idle, failed, and deleting lifecycles", () => {
    expect(workspacePhase(make({ status: "pending" }))).toBe("stopped");
    expect(workspacePhase(make({ status: "stopped" }))).toBe("stopped");
    expect(workspacePhase(make({ status: "failed" }))).toBe("failed");
    expect(workspacePhase(make({ status: "deleting" }))).toBe("deleting");
  });
});

describe("isWorkspaceSettling", () => {
  it("polls sooner only while something will change on its own", () => {
    expect(isWorkspaceSettling(make({ status: "provisioning" }))).toBe(true);
    expect(isWorkspaceSettling(make({ status: "deleting" }))).toBe(true);
    expect(isWorkspaceSettling(base)).toBe(false);
    expect(isWorkspaceSettling(make({ status: "stopped" }))).toBe(false);
  });

  it("waits for the owner after an interrupted deletion", () => {
    expect(
      isWorkspaceSettling(
        make({ status: "deleting", lastError: "Deletion failed." }),
      ),
    ).toBe(false);
  });
});

describe("formatting", () => {
  it("formats minutes compactly", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(180)).toBe("3h");
    expect(formatMinutes(754)).toBe("12h 34m");
    expect(formatMinutes(-5)).toBe("0m");
  });

  it("formats relative times", () => {
    const now = Date.parse("2026-10-01T12:00:00.000Z");
    expect(formatRelativeTime("2026-10-01T11:59:40.000Z", now)).toBe(
      "just now",
    );
    expect(formatRelativeTime("2026-10-01T11:55:00.000Z", now)).toBe(
      "5 minutes ago",
    );
    expect(formatRelativeTime("2026-09-30T12:00:00.000Z", now)).toBe(
      "yesterday",
    );
    expect(formatRelativeTime("not a date", now)).toBe("just now");
  });
});
