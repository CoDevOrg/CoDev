import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  useWorkspaceController,
  type WorkspaceShellBindings,
} from "./use-workspace-controller";

const CHAT = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  title: "Fix login",
  createdAt: "2026-10-09T00:00:00.000Z",
  updatedAt: "2026-10-09T00:00:00.000Z",
};

function bindings(
  overrides: Partial<WorkspaceShellBindings> = {},
): WorkspaceShellBindings {
  return {
    workspaceId: "ws-1",
    canEdit: true,
    previewEnabled: true,
    connected: true,
    viewMode: "board",
    setViewMode: vi.fn(),
    tab: "changes",
    setTab: vi.fn(),
    inspectorCollapsed: true,
    setInspectorCollapsed: vi.fn(),
    isNarrow: () => false,
    terminalExpanded: false,
    setTerminalExpanded: vi.fn(),
    worktreeId: "main",
    worktrees: [{ worktreeId: "main", branch: "main" }],
    addWorktree: vi.fn(),
    selectWorktree: vi.fn(() => true),
    fileCounts: {},
    dirty: false,
    chats: [CHAT],
    setChats: vi.fn(),
    activeChat: CHAT,
    activeProvider: "codex",
    connectedProviders: ["codex"],
    createChat: vi.fn(async () => CHAT),
    handleNewChat: vi.fn(),
    members: [],
    runs: [
      {
        id: "r1",
        chatId: CHAT.id,
        provider: "anthropic",
        status: "running",
        worktreeId: "main",
      },
    ],
    refreshRuns: vi.fn(),
    setShareOpen: vi.fn(),
    setSettingsOpen: vi.fn(),
    setImportOpen: vi.fn(),
    ...overrides,
  };
}

describe("useWorkspaceController", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("reveals a file in the inspector without pinning it open", async () => {
    const shell = bindings();
    const { result } = renderHook(() => useWorkspaceController(shell));
    const controller = result.current.value.controller;
    await act(() =>
      controller.run({ type: "open_file", path: "src/a.ts", line: 2 }),
    );
    expect(shell.setViewMode).toHaveBeenCalledWith("ide");
    expect(shell.setTab).toHaveBeenCalledWith("files");
    // The raw setter: the shell's viewport-following stays untouched.
    expect(shell.setInspectorCollapsed).toHaveBeenCalledWith(false);
    expect(result.current.requests.files.path).toBe("src/a.ts");
    expect(result.current.requests.files.range).toMatchObject({ line: 2 });
    expect(result.current.value.controller).toBe(controller);
  });

  it("turns requests into pane state: review focus, preview, share, draft, terminal", async () => {
    const shell = bindings();
    const { result } = renderHook(() => useWorkspaceController(shell));
    const { run } = result.current.value.controller;
    await act(async () => {
      await run({ type: "open_review", path: "src/a.ts" });
      await run({ type: "open_preview", port: 3000 });
      await run({ type: "open_share", emailOrLogin: "ada" });
      await run({ type: "start_chat", prompt: "Write tests" });
      await run({ type: "run_in_terminal", command: "npm test" });
    });
    const { inspector, chat, terminals } = result.current.requests;
    expect(inspector.changesToken).toBe(1);
    expect(inspector.reviewFocus).toMatchObject({ path: "src/a.ts" });
    expect(inspector.previewRequest).toMatchObject({ port: 3000, path: "/" });
    expect(chat.shareInvite).toMatchObject({ emailOrLogin: "ada" });
    expect(shell.setShareOpen).toHaveBeenCalledWith(true);
    expect(result.current.value.draftRequest?.text).toBe(
      `Write tests @[Fix login](chat:${CHAT.id})`,
    );
    expect(terminals.tabs).toMatchObject([
      { worktreeId: "main", label: "npm test" },
    ]);
    expect(terminals.activeId).toBe(terminals.tabs[0]!.id);
    expect(shell.setTerminalExpanded).toHaveBeenCalledWith(true);

    const draftId = result.current.value.draftRequest!.id;
    act(() => result.current.value.consumeDraftRequest(draftId));
    expect(result.current.value.draftRequest).toBeNull();
  });

  it("exposes the workspace to the chat: runs, snapshot, files and terminal", async () => {
    const files = [{ path: "src/a.ts", kind: "file", size: 10 }];
    const fetchMock = vi.fn(async () => Response.json({ files }));
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(
      (shell: WorkspaceShellBindings) => useWorkspaceController(shell),
      { initialProps: bindings() },
    );
    const { sources, getSnapshot } = result.current.value;
    expect(sources.agentRuns).toEqual([
      {
        id: "r1",
        chatId: CHAT.id,
        provider: "claude",
        status: "running",
        worktreeId: "main",
        branch: "main",
      },
    ]);
    expect(getSnapshot()?.view).toMatchObject({
      mode: "board",
      inspector: null,
    });
    expect(sources.terminalTail()).toBeNull();

    await expect(sources.listFiles()).resolves.toEqual(files);
    await sources.listFiles();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    sources.invalidateFiles();
    await sources.listFiles();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    rerender(bindings({ connected: false }));
    await waitFor(() =>
      expect(result.current.value.sources.listFiles()).resolves.toBeNull(),
    );
  });

  it("passes new chats, settings, import and view changes to the shell", async () => {
    const shell = bindings();
    const { result } = renderHook(() => useWorkspaceController(shell));
    const { controller } = result.current.value;
    await controller.newChat("codex");
    await controller.newChat();
    controller.openSettings();
    controller.openImport();
    controller.setViewMode("ide");
    expect(shell.createChat).toHaveBeenCalledWith("codex");
    expect(shell.handleNewChat).toHaveBeenCalled();
    expect(shell.setSettingsOpen).toHaveBeenCalledWith(true);
    expect(shell.setImportOpen).toHaveBeenCalledWith(true);
    expect(shell.setViewMode).toHaveBeenCalledWith("ide");
    expect(controller.autoRunBlocker({ type: "open_terminal" })).toBe(
      "Shown when you return to the IDE view",
    );
  });

  it("renames the open chat only once the server accepts", async () => {
    const shell = bindings();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ chat: { ...CHAT, title: "Login fix" } }),
      ),
    );
    const { result } = renderHook(() => useWorkspaceController(shell));
    const outcome = await result.current.value.controller.run({
      type: "rename_chat",
      title: "Login fix",
    });
    expect(outcome.ok).toBe(true);
    const update = vi.mocked(shell.setChats).mock.calls[0]![0] as (
      chats: (typeof CHAT)[],
    ) => (typeof CHAT)[];
    expect(update([CHAT])[0]!.title).toBe("Login fix");
  });
});
