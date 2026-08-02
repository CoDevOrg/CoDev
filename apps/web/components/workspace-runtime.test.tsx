import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceRuntime } from "./workspace-runtime";

describe("WorkspaceRuntime", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("automatically starts a hibernated workspace for an eligible member", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 201,
      ok: true,
      json: async () => ({ sandbox: { id: "sandbox-1" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <WorkspaceRuntime
        workspaceId="workspace-1"
        runtime={{ status: "hibernated", sandboxId: null, lastError: null }}
        canStartRuntime
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/workspace-1/sandbox",
        { method: "POST" },
      );
    });
  });

  it("does not wake compute for a viewer", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <WorkspaceRuntime
        workspaceId="workspace-1"
        runtime={{ status: "hibernated", sandboxId: null, lastError: null }}
        canStartRuntime={false}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
