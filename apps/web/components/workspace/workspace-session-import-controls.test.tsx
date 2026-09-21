import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WorkspaceSessionContinueAction,
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
  it("shows where to find a Codex rollout", () => {
    render(
      <WorkspaceSessionImportUpload workspaceId="workspace-1" canUpload />,
    );
    fireEvent.click(screen.getByText("Where is my Codex session file?"));
    expect(screen.getByText(/%USERPROFILE%/)).toBeTruthy();
    expect(screen.getByText(/CODEX_HOME/)).toBeTruthy();
    expect(screen.getByText(/history.jsonl/)).toBeTruthy();
  });

  it("uploads the selected Codex source with a stable idempotency key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ importId: "import-1" }, { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <WorkspaceSessionImportUpload workspaceId="workspace-1" canUpload />,
    );

    const file = new File(["rollout"], "session.jsonl", {
      type: "application/x-ndjson",
    });
    fireEvent.change(screen.getByLabelText("Codex session file"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import session" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces/workspace-1/session-imports/source",
      expect.objectContaining({
        method: "POST",
        body: file,
        headers: expect.objectContaining({
          "content-type": "application/x-ndjson",
          "x-session-provider": "codex",
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

  it("creates a continuation and opens its agent session", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { sessionId: "session-1", created: true },
          { status: 201 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <WorkspaceSessionContinueAction
        workspaceId="workspace-1"
        importId="import-1"
        status="ready"
        repositoryStatus="restored"
        agentSessionId={null}
        canContinue
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue in CoDev" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces/workspace-1/session-imports/import-1/continue",
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "/workspaces/workspace-1?agent=session-1",
      ),
    );
  });

  it("offers one-click continuation before the repository is prepared", () => {
    render(
      <WorkspaceSessionContinueAction
        workspaceId="workspace-1"
        importId="import-1"
        status="stored"
        repositoryStatus="pending"
        agentSessionId={null}
        canContinue
      />,
    );

    expect(
      screen.getByRole("button", { name: "Continue in CoDev" }),
    ).toBeEnabled();
    expect(
      screen.getByText(
        "CoDev will prepare an isolated copy of the repository automatically.",
      ),
    ).toBeTruthy();
  });

  it("offers chat-only continuation without requiring repository preparation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { sessionId: "chat-session-1", created: true },
          { status: 201 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <WorkspaceSessionContinueAction
        workspaceId="workspace-1"
        importId="import-1"
        status="stored"
        repositoryStatus="pending"
        agentSessionId={null}
        canContinue
        chatOnly
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue chat only" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces/workspace-1/session-imports/import-1/continue",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ chatOnly: true }),
      }),
    );
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "/workspaces/workspace-1?agent=chat-session-1",
      ),
    );
  });

  it("requires a restored repository before continuing", () => {
    render(
      <WorkspaceSessionContinueAction
        workspaceId="workspace-1"
        importId="import-1"
        status="ready"
        repositoryStatus="transcript_only"
        agentSessionId={null}
        canContinue
      />,
    );

    expect(
      screen.getByRole("button", { name: "Continue in CoDev" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "This import has no restored repository, so it can’t start a CoDev session.",
      ),
    ).toBeTruthy();
  });
});
