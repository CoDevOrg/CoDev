import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceRuntime } from "./workspace-runtime";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: React.PropsWithChildren<{ href: string }>) => <a {...props}>{children}</a>,
}));

describe("WorkspaceRuntime", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    refresh.mockReset();
  });

  it("auto-resumes a hibernated workspace for a resumable member", async () => {
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
        isOwner={false}
        canProvision={false}
        canResume
        defaultBranch="main"
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/workspace-1/sandbox",
        { method: "POST" },
      );
      expect(refresh).toHaveBeenCalled();
    });
  });

  it("does not wake compute for a viewer", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <WorkspaceRuntime
        workspaceId="workspace-1"
        runtime={{ status: "hibernated", sandboxId: null, lastError: null }}
        isOwner={false}
        canProvision={false}
        canResume={false}
        defaultBranch="main"
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
