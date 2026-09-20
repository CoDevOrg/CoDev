import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WorkspaceSessionImportUpload,
  WorkspaceSessionRestoreActions,
} from "./workspace-session-import-controls";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockReset();
  refresh.mockReset();
});

describe("session import controls", () => {
  it("uploads the selected capsule with a stable idempotency key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ importId: "import-1" }, { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <WorkspaceSessionImportUpload workspaceId="workspace-1" canUpload />,
    );

    const file = new File(["capsule"], "session.codevsc", {
      type: "application/vnd.codev.session-capsule.v0",
    });
    fireEvent.change(screen.getByLabelText("Capsule file"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import session" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces/workspace-1/session-imports",
      expect.objectContaining({
        method: "POST",
        body: file,
        headers: expect.objectContaining({
          "content-type": "application/vnd.codev.session-capsule.v0",
          "idempotency-key": expect.any(String),
        }),
      }),
    );
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "/workspaces/workspace-1/session-imports?import=import-1",
      ),
    );
  });

  it("offers transcript-only only after a recorded conflict", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ status: "ready", repositoryStatus: "transcript_only" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(
      <WorkspaceSessionRestoreActions
        workspaceId="workspace-1"
        importId="import-1"
        status="stored"
        repositoryStatus="pending"
        canRestore
      />,
    );
    expect(screen.queryByText("Continue with transcript only")).toBeNull();

    rerender(
      <WorkspaceSessionRestoreActions
        workspaceId="workspace-1"
        importId="import-1"
        status="restoring"
        repositoryStatus="conflicted"
        canRestore
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with transcript only" }),
    );

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces/workspace-1/session-imports/import-1/restore",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ transcriptOnly: true }),
      }),
    );
  });
});
