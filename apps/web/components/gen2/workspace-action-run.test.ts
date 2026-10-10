import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Gen2Chat, Gen2WorkspaceAction } from "@codev/contracts";

import { workspaceActionBlocker } from "./workspace-action-blocker";
import {
  runWorkspaceAction,
  type WorkspaceActionOps,
  type WorkspaceActionView,
} from "./workspace-action-run";

const CHAT: Gen2Chat = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  title: "Fix login",
  createdAt: "2026-10-09T00:00:00.000Z",
  updatedAt: "2026-10-09T00:00:00.000Z",
};

function makeOps(overrides: Partial<WorkspaceActionView> = {}) {
  const view: WorkspaceActionView = {
    canEdit: true,
    previewEnabled: true,
    viewMode: "ide",
    narrow: false,
    worktreeId: "main",
    worktrees: [
      { worktreeId: "main", branch: "main" },
      { worktreeId: "feat-a", branch: "feat/a" },
    ],
    dirty: false,
    openFilePath: null,
    listeningPorts: [3000],
    activeChat: { id: "chat-1", title: "Fix login" },
    activeProvider: "codex",
    connectedProviders: ["codex", "claude"],
    ...overrides,
  };
  return {
    workspaceId: "ws-1",
    view: () => view,
    reveal: vi.fn(),
    openFile: vi.fn(),
    refreshChanges: vi.fn(),
    focusReview: vi.fn(),
    openTerminal: vi.fn(),
    openTerminalTab: vi.fn(),
    requestPreview: vi.fn(),
    selectWorktree: vi.fn(() => true),
    addWorktree: vi.fn(),
    openShare: vi.fn(),
    openSettings: vi.fn(),
    createChat: vi.fn(async () => CHAT),
    setDraft: vi.fn(),
    renameChat: vi.fn(async () => null),
  } satisfies WorkspaceActionOps;
}

const run = (action: Gen2WorkspaceAction, ops: WorkspaceActionOps) =>
  runWorkspaceAction(action, ops);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("workspaceActionBlocker", () => {
  const view = makeOps().view();
  const block = (
    action: Gen2WorkspaceAction,
    overrides: Partial<WorkspaceActionView> = {},
  ) => workspaceActionBlocker(action, { ...view, ...overrides });
  const openFile = { type: "open_file", path: "src/api.ts" } as const;

  it("lets navigation run only when it costs the member nothing", () => {
    expect(block(openFile)).toBeNull();
    expect(block({ type: "open_preview", port: 3000 })).toBeNull();
    expect(block({ type: "rename_chat", title: "Login" })).toBeNull();
  });

  it("holds every proposal for a click", () => {
    expect(block({ type: "open_settings" })).toBe("Waits for you to confirm");
    expect(
      block({ type: "invite_members", people: ["ada"], role: "editor" }),
    ).toBe("Waits for you to confirm");
  });

  it("explains why navigation waits", () => {
    expect(block({ ...openFile, worktreeId: "feat-a" })).toBe(
      "Opens feat/a; your terminal on main closes",
    );
    expect(block(openFile, { dirty: true, openFilePath: "src/a.ts" })).toBe(
      "You have unsaved changes in a.ts",
    );
    expect(block(openFile, { viewMode: "board" })).toBe(
      "Shown when you return to the IDE view",
    );
    expect(block(openFile, { narrow: true })).toBe(
      "The window is too narrow to show it beside the chat",
    );
    expect(block({ type: "open_preview", port: 5173 })).toBe(
      "Nothing is listening on :5173 yet",
    );
    expect(
      block({ type: "open_preview", port: 3000 }, { previewEnabled: false }),
    ).toBe("Browser preview isn’t available in this workspace");
    expect(block({ type: "rename_chat", title: "x" }, { canEdit: false })).toBe(
      "Only editors can rename chats",
    );
  });
});

describe("runWorkspaceAction", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("opens a file range in Files", async () => {
    const ops = makeOps();
    const result = await run(
      { type: "open_file", path: "src/a.ts", line: 4, endLine: 9 },
      ops,
    );
    expect(ops.reveal).toHaveBeenCalledWith("files");
    expect(ops.openFile).toHaveBeenCalledWith("src/a.ts", {
      line: 4,
      endLine: 9,
    });
    expect(result).toEqual({
      ok: true,
      message: "Opened src/a.ts:4-9 in Files",
    });
  });

  it("switches worktree through the guarded switch before revealing", async () => {
    const ops = makeOps();
    await run(
      { type: "open_review", worktreeId: "feat-a", path: "src/a.ts" },
      ops,
    );
    expect(ops.selectWorktree).toHaveBeenCalledWith("feat-a");
    expect(ops.reveal).toHaveBeenCalledWith("review");
    expect(ops.refreshChanges).toHaveBeenCalled();
    expect(ops.focusReview).toHaveBeenCalledWith("src/a.ts");

    const dirty = makeOps();
    dirty.selectWorktree.mockReturnValue(false);
    const result = await run(
      { type: "show_changes", worktreeId: "feat-a" },
      dirty,
    );
    expect(result.ok).toBe(false);
    expect(dirty.reveal).not.toHaveBeenCalled();
  });

  it("requests a preview only where previews exist", async () => {
    const ops = makeOps();
    await run({ type: "open_preview", port: 3000, path: "/login" }, ops);
    expect(ops.reveal).toHaveBeenCalledWith("browser");
    expect(ops.requestPreview).toHaveBeenCalledWith(3000, "/login");
    const off = makeOps({ previewEnabled: false });
    expect((await run({ type: "open_preview", port: 3000 }, off)).ok).toBe(
      false,
    );
  });

  it("creates a branch from the member's branch, or from HEAD on main", async () => {
    const fetchMock = vi.fn<
      (url: string, init: RequestInit) => Promise<Response>
    >(async () =>
      json({ worktree: { worktreeId: "feat-b", branch: "feat/b" } }, 201),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onBranch = makeOps({ worktreeId: "feat-a" });
    await run({ type: "create_branch", branch: "feat/b" }, onBranch);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({
      worktreeId: "feat-b",
      branch: "feat/b",
      baseRef: "feat/a",
    });
    expect(onBranch.addWorktree).toHaveBeenCalled();
    expect(onBranch.selectWorktree).toHaveBeenCalledWith("feat-b");

    await run({ type: "create_branch", branch: "feat/b" }, makeOps());
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toEqual({
      worktreeId: "feat-b",
      branch: "feat/b",
    });
  });

  it("invites only new people, one at a time, and never touches the share link", async () => {
    const members = [
      { userId: "u1", login: "alice", name: null, email: null, role: "owner" },
      {
        userId: "u2",
        login: "bobby",
        name: null,
        email: "bob@example.com",
        role: "viewer",
      },
    ];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init?.method) return json({ members, ownerId: "u1" });
      const { emailOrLogin } = JSON.parse(String(init.body)) as {
        emailOrLogin: string;
      };
      return emailOrLogin === "nobody"
        ? json({ error: "No user found." }, 404)
        : json({ members: [...members, { login: emailOrLogin }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await run(
      {
        type: "invite_members",
        people: ["@alice", "Bob@Example.com", "@carol", "nobody"],
        role: "editor",
      },
      makeOps(),
    );

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.every((url) => url.endsWith("/members"))).toBe(true);
    expect(urls.some((url) => url.includes("/share"))).toBe(false);
    const posted = fetchMock.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init!.body)));
    // A handle written as @login is sent bare, as CoDev looks logins up.
    expect(posted).toEqual([
      { emailOrLogin: "carol", role: "editor" },
      { emailOrLogin: "nobody", role: "editor" },
    ]);
    expect(result).toEqual({
      ok: true,
      message: "Invited 1 · 2 already had access · 1 needs an invite link",
      details: [
        { person: "@alice", ok: true, message: "Already has access as owner" },
        {
          person: "Bob@Example.com",
          ok: true,
          message: "Already has access as viewer",
        },
        { person: "@carol", ok: true, message: "Added as editor" },
        { person: "nobody", ok: false, message: "No CoDev account" },
      ],
    });
  });

  it("refuses proposals for viewers without calling the server", async () => {
    const ops = makeOps({ canEdit: false });
    const result = await run(
      { type: "invite_members", people: ["ada"], role: "editor" },
      ops,
    );
    expect(result.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (await run({ type: "run_in_terminal", command: "rm -rf /" }, ops)).ok,
    ).toBe(false);
    expect(ops.openTerminalTab).not.toHaveBeenCalled();
  });

  it("runs a command in a new terminal tab for its worktree", async () => {
    const ops = makeOps();
    const result = await run(
      { type: "run_in_terminal", command: "npm test", worktreeId: "feat-a" },
      ops,
    );
    expect(ops.openTerminalTab).toHaveBeenCalledWith("feat-a", "npm test");
    expect(ops.openTerminal).toHaveBeenCalled();
    expect(result.message).toBe(
      "Runs in a new terminal on feat/a once you switch there",
    );
  });

  it("starts a chat that links back to this one, without sending", async () => {
    const ops = makeOps();
    await run(
      { type: "start_chat", provider: "claude", prompt: "Write the tests" },
      ops,
    );
    expect(ops.createChat).toHaveBeenCalledWith("claude");
    expect(ops.setDraft).toHaveBeenCalledWith(
      "Write the tests @[Fix login](chat:chat-1)",
    );
    const cursor = await run(
      { type: "start_chat", provider: "cursor", prompt: "Hi" },
      makeOps(),
    );
    expect(cursor).toEqual({
      ok: false,
      message: "Connect Cursor in Settings first.",
    });
  });

  it("opens Share prefilled, and an existing branch by switching", async () => {
    const ops = makeOps();
    await run({ type: "open_share", emailOrLogin: "ada@example.com" }, ops);
    expect(ops.openShare).toHaveBeenCalledWith("ada@example.com");
    await run({ type: "open_branch", branch: "feat/a" }, ops);
    expect(ops.selectWorktree).toHaveBeenCalledWith("feat-a");
  });
});
