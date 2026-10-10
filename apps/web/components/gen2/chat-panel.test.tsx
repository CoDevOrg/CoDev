import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Gen2WorkspaceContext,
  Gen2WorkspaceDetail,
} from "@codev/contracts";

import { Gen2ChatPanel, type Gen2ChatPanelProps } from "./chat-panel";
import {
  WorkspaceAgentContext,
  type WorkspaceAgentContextValue,
} from "./workspace-controller";

const workspace: Gen2WorkspaceDetail = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Studio",
  repository: null,
  status: "ready",
  sandboxId: "sandbox-1",
  runtimeProvider: "firecracker",
  runtimeStatus: "ready",
  runtimeGeneration: 0,
  lastError: null,
  role: "owner",
  createdAt: "2026-09-20T20:00:00.000Z",
  updatedAt: "2026-09-20T20:00:00.000Z",
  members: [],
};

function ndjson(...lines: string[]) {
  return [
    {
      sequence: 0,
      dataBase64: Buffer.from(lines.join("\n")).toString("base64"),
    },
  ];
}

const CHAT = { id: "33333333-3333-4333-8333-333333333333", title: "New chat" };

const SNAPSHOT: Gen2WorkspaceContext = {
  view: { mode: "ide", inspector: "files", terminalOpen: false, narrow: false },
  worktree: {
    id: "main",
    branch: "main",
    changedFiles: 2,
    unsavedEdits: false,
  },
  worktrees: [
    { id: "main", branch: "main" },
    { id: "feat-login", branch: "feat/login" },
  ],
  openFile: null,
  preview: null,
  listeningPorts: null,
  members: [{ login: "ada", role: "owner" }],
  agents: [],
  excerpts: [],
  previewEnabled: false,
};

function agentContext(
  overrides: Partial<WorkspaceAgentContextValue["sources"]> = {},
  extra: Partial<WorkspaceAgentContextValue> = {},
): WorkspaceAgentContextValue {
  return {
    controller: {
      autoRunBlocker: vi.fn(() => null),
      run: vi.fn(async () => ({ ok: true, message: "" })),
      newChat: vi.fn(async () => undefined),
      openSettings: vi.fn(),
      openImport: vi.fn(),
      setViewMode: vi.fn(),
    },
    getSnapshot: () => SNAPSHOT,
    canEdit: true,
    previewEnabled: false,
    sources: {
      chats: [],
      activeChatId: null,
      worktreeId: "main",
      agentRuns: [],
      refreshRuns: vi.fn(),
      listFiles: vi.fn(async () => [
        { path: "src/app.ts", kind: "file" as const, size: 10 },
        { path: "src/api.ts", kind: "file" as const, size: 10 },
      ]),
      invalidateFiles: vi.fn(),
      selection: () => null,
      terminalTail: () => null,
      ...overrides,
    },
    draftRequest: null,
    consumeDraftRequest: vi.fn(),
    ...extra,
  };
}

function renderPanel(
  props: Partial<Gen2ChatPanelProps> = {},
  context: WorkspaceAgentContextValue | null = null,
) {
  const panel = (
    <Gen2ChatPanel
      workspace={workspace}
      onRunningChange={vi.fn()}
      onFilesChanged={vi.fn()}
      onOpenFile={vi.fn()}
      onNeedsMachine={async () => true}
      {...props}
    />
  );
  return render(
    context ? (
      <WorkspaceAgentContext.Provider value={context}>
        {panel}
      </WorkspaceAgentContext.Provider>
    ) : (
      panel
    ),
  );
}

function agentPosts() {
  return vi
    .mocked(fetch)
    .mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith("/agent") && init?.method === "POST",
    )
    .map(([, init]) => JSON.parse(String(init?.body)));
}

function type(value: string) {
  fireEvent.change(screen.getByLabelText("Prompt"), { target: { value } });
}

async function sendReady() {
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled(),
  );
}

describe("Gen2ChatPanel", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  function stubFetch(handlers: {
    start?: () => Response | Promise<Response>;
    poll?: () => unknown | Promise<unknown>;
    messages?: unknown[];
    /** Messages the chat holds before this test's turns. */
    history?: unknown[];
    provider?: {
      connected: boolean;
      via: string | null;
      models?: Array<{ id: string; label: string }>;
      modelsError?: string;
    };
    allProviders?: unknown;
  }) {
    let turnFinished = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url);
        const json = (body: unknown) =>
          new Response(JSON.stringify(body), { status: 200 });
        if (path.endsWith("/agent/poll")) {
          // `poll` may return a promise so a test can hold a turn open.
          // Await it before serialising, or the body becomes `{}`.
          const result = (await (handlers.poll?.() ?? {
            chunks: [],
            nextSequence: 1,
            exited: true,
          })) as { exited: boolean };
          if (result.exited) turnFinished = true;
          return json(result);
        }
        if (path.endsWith("/agent"))
          return handlers.start?.() ?? json({ sessionId: "session-1" });
        if (path.includes("/chats/")) {
          // The assistant message exists only once the server has written
          // it, which it does as the turn exits.
          return json({
            chat: {
              ...CHAT,
              messages: [
                ...(handlers.history ?? []),
                ...(turnFinished ? (handlers.messages ?? []) : []),
              ],
            },
          });
        }
        if (path.endsWith("/branches"))
          return json({
            branches: [{ name: "main" }, { name: "feat/remote" }],
            defaultBranch: "main",
            truncated: false,
            unavailable: null,
          });
        if (path.includes("/api/gen2/providers")) {
          if (path.includes("provider=all") && handlers.allProviders) {
            return json(handlers.allProviders);
          }
          if (handlers.allProviders && !path.includes("provider=all")) {
            const entry = (handlers.allProviders as Record<string, unknown>)[
              path.includes("provider=cursor")
                ? "cursor"
                : path.includes("provider=claude")
                  ? "claude"
                  : "codex"
            ];
            if (entry) return json(entry);
          }
          const fixtures = {
            codex: [{ id: "gpt-5.6-luna", label: "GPT-5.6 Luna" }],
            claude: [{ id: "sonnet", label: "Sonnet" }],
            cursor: [{ id: "composer-2.5", label: "Composer 2.5" }],
          };
          return json(
            handlers.provider ?? {
              connected: true,
              via: "api-key",
              models:
                fixtures[
                  path.includes("provider=cursor")
                    ? "cursor"
                    : path.includes("provider=claude")
                      ? "claude"
                      : "codex"
                ],
            },
          );
        }
        if (path.endsWith("/chats")) {
          return init?.method === "POST"
            ? json({ chat: CHAT })
            : json({ chats: [CHAT] });
        }
        if (path.endsWith("/files") && init?.method === "PATCH") {
          return json({ revision: "rev-1" });
        }
        throw new Error(`unstubbed fetch: ${init?.method ?? "GET"} ${path}`);
      }),
    );
  }

  it("restores the draft and removes the optimistic message when storage rejects a start", async () => {
    stubFetch({
      start: () =>
        Response.json(
          { error: "Chat storage is being updated. Please try again shortly." },
          { status: 503 },
        ),
    });
    render(
      <Gen2ChatPanel
        workspace={workspace}
        onRunningChange={vi.fn()}
        onFilesChanged={vi.fn()}
        onOpenFile={vi.fn()}
        onNeedsMachine={async () => true}
      />,
    );
    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "Please review my files" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(
      await screen.findByText(
        "Chat storage is being updated. Please try again shortly.",
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Prompt")).toHaveValue(
        "Please review my files",
      ),
    );
    expect(screen.getAllByText("Please review my files")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("warns about a similar active task and starts only when the member confirms", async () => {
    const duplicate = {
      runId: "44444444-4444-4444-8444-444444444444",
      worktreeId: "fix-auth",
      provider: "claude",
      createdBy: "55555555-5555-4555-8555-555555555555",
      status: "running",
      task: "Fix the token refresh bug in auth middleware",
    };
    const starts: unknown[] = [];
    stubFetch({
      start: () => {
        starts.push(null);
        return starts.length === 1
          ? Response.json({ possibleDuplicate: duplicate })
          : Response.json({ sessionId: "session-1" });
      },
    });
    const onOpenWorktree = vi.fn();
    render(
      <Gen2ChatPanel
        workspace={workspace}
        onRunningChange={vi.fn()}
        onFilesChanged={vi.fn()}
        onOpenFile={vi.fn()}
        onNeedsMachine={async () => true}
        onOpenWorktree={onOpenWorktree}
      />,
    );
    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "The auth middleware token refresh bug needs a fix" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText(duplicate.task)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Prompt")).toHaveValue(
        "The auth middleware token refresh bug needs a fix",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Start anyway" }));
    await waitFor(() => expect(starts).toHaveLength(2));
    const bodies = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith("/agent") && init?.method === "POST",
      )
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies[0]).not.toHaveProperty("acknowledgedDuplicateOf");
    expect(bodies[1]).toMatchObject({
      acknowledgedDuplicateOf: duplicate.runId,
    });
    expect(screen.queryByText(duplicate.task)).not.toBeInTheDocument();
    expect(onOpenWorktree).not.toHaveBeenCalled();
  });

  it("restores the draft after a network failure while starting", async () => {
    stubFetch({
      start: () => {
        throw new TypeError("network failed");
      },
    });
    render(
      <Gen2ChatPanel
        workspace={workspace}
        onRunningChange={vi.fn()}
        onFilesChanged={vi.fn()}
        onOpenFile={vi.fn()}
        onNeedsMachine={async () => true}
      />,
    );
    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "Keep this draft" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(
      await screen.findByText("Couldn't reach CoDev. Try again."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Prompt")).toHaveValue("Keep this draft"),
    );
  });

  it("renders what Codex did while the turn is still running", async () => {
    // Hold the first poll open: without it the turn resolves inside one
    // microtask flush and React coalesces the intermediate render away, so
    // there would be nothing to assert about a *running* turn.
    let releaseFirstPoll: (() => void) | undefined;
    const firstPollHeld = new Promise<void>((resolve) => {
      releaseFirstPoll = resolve;
    });
    let call = 0;
    stubFetch({
      poll: () => {
        call += 1;
        if (call === 1) {
          return {
            chunks: ndjson(
              `{"type":"item.completed","item":{"id":"c1","type":"command_execution","command":"ls","aggregated_output":"a.ts","exit_code":0}}`,
            ),
            nextSequence: 1,
            exited: false,
          };
        }
        return firstPollHeld.then(() => ({
          chunks: ndjson(
            `{"type":"item.completed","item":{"id":"m1","type":"agent_message","text":"Listed them."}}`,
            `{"type":"turn.completed"}`,
          ),
          nextSequence: 2,
          exited: true,
        }));
      },
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          body: "Listed them.",
          items: [
            {
              id: "c1",
              kind: "command",
              status: "completed",
              command: "ls",
              output: "a.ts",
              exitCode: 0,
            },
          ],
          createdAt: "2026-09-20T20:01:00.000Z",
        },
      ],
    });

    render(
      <Gen2ChatPanel
        workspace={workspace}
        onRunningChange={vi.fn()}
        onFilesChanged={vi.fn()}
        onOpenFile={vi.fn()}
        onNeedsMachine={async () => true}
      />,
    );

    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "list the files" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // Live turns keep the step timeline open with a short label.
    expect(await screen.findByText("Listed files")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Stop/ })).toBeInTheDocument();

    releaseFirstPoll?.();

    // The reply comes back from the reloaded thread, which the server wrote
    // as the turn exited -- the client never posts it.
    expect(await screen.findByText("Listed them.")).toBeInTheDocument();
    // Completed turns collapse to the summary; expand to see the step.
    fireEvent.click(screen.getByRole("button", { name: /Worked/ }));
    expect(screen.getByText("Listed files")).toBeInTheDocument();
  });

  it("hands a finished reply to the saved thread without showing it twice", async () => {
    let exited = false;
    stubFetch({
      poll: () => {
        exited = true;
        return {
          chunks: ndjson(
            `{"type":"item.completed","item":{"id":"m1","type":"agent_message","text":"All done."}}`,
            `{"type":"turn.completed"}`,
          ),
          nextSequence: 1,
          exited: true,
        };
      },
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          body: "All done.",
          createdAt: "2026-09-20T20:01:00.000Z",
        },
      ],
    });
    const original = vi.mocked(fetch).getMockImplementation()!;
    let releaseThread!: () => void;
    const threadHeld = new Promise<void>((resolve) => {
      releaseThread = resolve;
    });
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (exited && String(url).includes("/chats/")) await threadHeld;
      return original(url, init);
    });
    render(
      <Gen2ChatPanel
        workspace={workspace}
        onRunningChange={vi.fn()}
        onFilesChanged={vi.fn()}
        onOpenFile={vi.fn()}
        onNeedsMachine={async () => true}
      />,
    );
    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "finish up" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // While the saved thread reloads, the streamed reply stays in place.
    expect(await screen.findByText("All done.")).toBeInTheDocument();
    expect(screen.queryByText("Thinking…")).toBeNull();
    expect(screen.queryByText("Starting the agent…")).toBeNull();

    releaseThread();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Stop/ })).toBeNull(),
    );
    expect(screen.getAllByText("All done.")).toHaveLength(1);
    expect(screen.queryByText("Thinking…")).toBeNull();
  });

  it("clears the previous chat while the next one loads", async () => {
    stubFetch({});
    const original = vi.mocked(fetch).getMockImplementation()!;
    const other = "66666666-6666-4666-8666-666666666666";
    let releaseOther!: () => void;
    const otherHeld = new Promise<void>((resolve) => {
      releaseOther = resolve;
    });
    const message = (id: string, body: string) => ({
      id,
      role: "user",
      body,
      createdAt: "2026-09-20T20:00:00.000Z",
    });
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const path = String(url);
      if (path.endsWith(`/chats/${CHAT.id}`))
        return Response.json({
          chat: { ...CHAT, messages: [message("a-1", "From the first chat")] },
        });
      if (path.endsWith(`/chats/${other}`)) {
        await otherHeld;
        return Response.json({
          chat: {
            id: other,
            title: "Other",
            messages: [message("b-1", "From the second chat")],
          },
        });
      }
      return original(url, init);
    });
    const props = {
      workspace,
      onRunningChange: vi.fn(),
      onFilesChanged: vi.fn(),
      onOpenFile: vi.fn(),
      onNeedsMachine: async () => true,
    };
    const view = render(<Gen2ChatPanel {...props} activeChatId={CHAT.id} />);
    expect(await screen.findByText("From the first chat")).toBeInTheDocument();

    view.rerender(<Gen2ChatPanel {...props} activeChatId={other} />);
    expect(screen.queryByText("From the first chat")).toBeNull();
    expect(screen.queryByText("What should we build?")).toBeNull();

    releaseOther();
    expect(await screen.findByText("From the second chat")).toBeInTheDocument();
  });

  it("tells the workbench when the agent touched the filesystem", async () => {
    const onFilesChanged = vi.fn();
    stubFetch({
      poll: () => ({
        chunks: ndjson(
          `{"type":"item.completed","item":{"id":"f1","type":"file_change","changes":[{"path":"/workspace/a.ts","kind":"modify"}]}}`,
          `{"type":"turn.completed"}`,
        ),
        nextSequence: 1,
        exited: true,
      }),
    });

    render(
      <Gen2ChatPanel
        workspace={workspace}
        onRunningChange={vi.fn()}
        onFilesChanged={onFilesChanged}
        onOpenFile={vi.fn()}
        onNeedsMachine={async () => true}
      />,
    );
    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "edit a.ts" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(onFilesChanged).toHaveBeenCalled());
  });

  it("publishes whether a turn is running so the workbench can pause", async () => {
    const onRunningChange = vi.fn();
    let releasePoll: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      releasePoll = resolve;
    });
    stubFetch({
      poll: () =>
        held.then(() => ({ chunks: [], nextSequence: 1, exited: true })),
    });
    render(
      <Gen2ChatPanel
        workspace={workspace}
        onRunningChange={onRunningChange}
        onFilesChanged={vi.fn()}
        onOpenFile={vi.fn()}
        onNeedsMachine={async () => true}
      />,
    );
    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "go" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(onRunningChange).toHaveBeenCalledWith(true));
    releasePoll?.();
    await waitFor(() =>
      expect(onRunningChange).toHaveBeenLastCalledWith(false),
    );
  });

  it("wakes the machine instead of refusing the prompt", async () => {
    // The composer is never disabled. A member who opens a cold workspace and
    // types straight away should get a turn, not a dead text box.
    const onNeedsMachine = vi.fn().mockResolvedValue(true);
    stubFetch({});
    render(
      <Gen2ChatPanel
        workspace={{ ...workspace, status: "pending" }}
        onRunningChange={vi.fn()}
        onFilesChanged={vi.fn()}
        onOpenFile={vi.fn()}
        onNeedsMachine={onNeedsMachine}
      />,
    );
    const prompt = screen.getByLabelText("Prompt");
    expect(prompt).not.toBeDisabled();

    fireEvent.change(prompt, { target: { value: "go" } });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(onNeedsMachine).toHaveBeenCalled());
  });

  it("keeps the prompt when the machine will not come up", async () => {
    stubFetch({});
    render(
      <Gen2ChatPanel
        workspace={{ ...workspace, status: "failed" }}
        onRunningChange={vi.fn()}
        onFilesChanged={vi.fn()}
        onOpenFile={vi.fn()}
        onNeedsMachine={async () => false}
      />,
    );
    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "do the thing" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /reconnect to the workspace/,
    );
    // Their words are not thrown away.
    expect(screen.getByLabelText("Prompt")).toHaveValue("do the thing");
  });

  it("asks for a Codex connection instead of a composer that cannot work", async () => {
    // Turns run on the member's own credential. Without one every turn would
    // fail with the same error, so ask for it where the work happens.
    stubFetch({ provider: { connected: false, via: null } });
    render(
      <Gen2ChatPanel
        workspace={workspace}
        onRunningChange={vi.fn()}
        onFilesChanged={vi.fn()}
        onOpenFile={vi.fn()}
        onNeedsMachine={async () => true}
      />,
    );
    expect(
      await screen.findByText("Connect ChatGPT to run Codex"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Prompt")).toBeNull();
  });

  it("shows the composer once a credential is connected", async () => {
    stubFetch({ provider: { connected: true, via: "subscription" } });
    render(
      <Gen2ChatPanel
        workspace={workspace}
        onRunningChange={vi.fn()}
        onFilesChanged={vi.fn()}
        onOpenFile={vi.fn()}
        onNeedsMachine={async () => true}
      />,
    );
    expect(await screen.findByLabelText("Prompt")).toBeInTheDocument();
    expect(screen.queryByText("Connect ChatGPT to run Codex")).toBeNull();
  });

  it("uploads attached text files onto the machine before starting the turn", async () => {
    const onFilesChanged = vi.fn();
    stubFetch({});
    render(
      <Gen2ChatPanel
        workspace={workspace}
        onRunningChange={vi.fn()}
        onFilesChanged={onFilesChanged}
        onOpenFile={vi.fn()}
        onNeedsMachine={async () => true}
      />,
    );

    const file = new File(["export const n = 1;\n"], "notes.ts", {
      type: "text/typescript",
    });
    fireEvent.change(screen.getByLabelText("Choose files to attach"), {
      target: { files: [file] },
    });

    expect(await screen.findByText("notes.ts")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "review this" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      const fetchMock = vi.mocked(fetch);
      const upload = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith("/files") && init?.method === "PATCH",
      );
      expect(upload).toBeTruthy();
      expect(JSON.parse(String(upload?.[1]?.body))).toMatchObject({
        path: ".codev/uploads/notes.ts",
        contents: "export const n = 1;\n",
        overwrite: true,
      });
      const agent = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith("/agent") && init?.method === "POST",
      );
      expect(JSON.parse(String(agent?.[1]?.body)).prompt).toContain(
        ".codev/uploads/notes.ts",
      );
      expect(JSON.parse(String(agent?.[1]?.body)).prompt).toContain(
        "review this",
      );
    });
    expect(onFilesChanged).toHaveBeenCalled();
  });

  it("fills the prompt from an empty-state card without sending", async () => {
    stubFetch({});
    render(
      <Gen2ChatPanel
        workspace={workspace}
        onRunningChange={vi.fn()}
        onFilesChanged={vi.fn()}
        onOpenFile={vi.fn()}
        onNeedsMachine={async () => true}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "What should we build?" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Plan before building/ }),
    );
    expect(screen.getByLabelText("Prompt")).toHaveValue("/plan ");
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([url, init]) =>
            String(url).endsWith("/agent") && init?.method === "POST",
        ),
    ).toBe(false);
  });

  it.each([
    { provider: "claude", model: "sonnet" },
    { provider: "cursor", model: "composer-2.5" },
  ] as const)(
    "sends a valid $provider model even with a saved model from another provider",
    async ({ provider, model }) => {
      if (provider === "cursor")
        sessionStorage.setItem(
          `codev-gen2-model:${workspace.id}`,
          "gpt-5.6-luna",
        );
      stubFetch({});
      render(
        <Gen2ChatPanel
          workspace={workspace}
          onRunningChange={vi.fn()}
          onFilesChanged={vi.fn()}
          onOpenFile={vi.fn()}
          onNeedsMachine={async () => true}
          activeProvider={provider}
        />,
      );

      await screen.findByRole("heading", { name: "What should we build?" });
      fireEvent.change(screen.getByLabelText("Prompt"), {
        target: { value: "hello agent" },
      });
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Send" })).toBeEnabled(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Send" }));

      await waitFor(() => {
        const agentCall = vi
          .mocked(fetch)
          .mock.calls.find(
            ([url, init]) =>
              String(url).endsWith("/agent") && init?.method === "POST",
          );
        expect(agentCall).toBeDefined();
        const body = JSON.parse(String(agentCall?.[1]?.body));
        expect(body.provider).toBe(provider);
        expect(body.model).toBe(model);
      });
    },
  );

  it("populates and uses dynamically fetched models from providers endpoint", async () => {
    stubFetch({
      allProviders: {
        claude: {
          connected: true,
          via: "api-key",
          models: [
            { id: "claude-sonnet-5.5", label: "Claude Sonnet 5.5" },
            { id: "claude-opus-5.5", label: "Claude Opus 5.5" },
          ],
        },
        codex: {
          connected: true,
          via: "api-key",
          models: [{ id: "gpt-6.1-sol", label: "GPT-6.1 Sol" }],
        },
      },
    });

    render(
      <Gen2ChatPanel
        workspace={workspace}
        onRunningChange={vi.fn()}
        onFilesChanged={vi.fn()}
        onOpenFile={vi.fn()}
        onNeedsMachine={async () => true}
        activeProvider="claude"
      />,
    );

    // The dropdown trigger should display the dynamic model once loaded
    expect(
      await screen.findByRole("button", { name: "Agent" }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Claude Sonnet 5.5/)).toBeInTheDocument();
  });
  it("does not let a late Codex catalog overwrite a Cursor selection", async () => {
    stubFetch({});
    const original = vi.mocked(fetch).getMockImplementation()!;
    let resolveCodex!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation((url, init) => {
      if (String(url).endsWith("provider=codex"))
        return new Promise<Response>((resolve) => {
          resolveCodex = resolve;
        });
      return original(url, init);
    });
    const props = {
      workspace,
      onRunningChange: vi.fn(),
      onFilesChanged: vi.fn(),
      onOpenFile: vi.fn(),
      onNeedsMachine: async () => true,
    };
    const view = render(
      <Gen2ChatPanel
        {...props}
        activeProvider="codex"
        connectedProviders={["codex", "cursor"]}
      />,
    );
    await waitFor(() => expect(resolveCodex).toBeDefined());
    view.rerender(
      <Gen2ChatPanel
        {...props}
        activeProvider="cursor"
        connectedProviders={["codex", "cursor"]}
      />,
    );
    expect(
      await screen.findByText(/Cursor · Composer 2.5/),
    ).toBeInTheDocument();
    resolveCodex(
      Response.json({
        connected: true,
        via: "subscription",
        models: [{ id: "codex-only", label: "Codex only" }],
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Agent" })).toHaveTextContent(
        "Cursor · Composer 2.5",
      ),
    );
    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "hello" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      const call = vi
        .mocked(fetch)
        .mock.calls.find(
          ([url, init]) =>
            String(url).endsWith("/agent") && init?.method === "POST",
        );
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
        provider: "cursor",
        model: "composer-2.5",
      });
    });
  });
  it("moves through the slash menu with the keyboard and inserts a mode", async () => {
    stubFetch({});
    renderPanel();
    const prompt = await screen.findByLabelText("Prompt");
    type("/");
    const listbox = await screen.findByRole("listbox", { name: "Commands" });
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/plan"),
        expect.stringContaining("/ask"),
      ]),
    );
    // Without the workspace shell there are no workspace commands.
    expect(screen.queryByText("/changes")).toBeNull();
    expect(prompt).toHaveAttribute("aria-controls", listbox.id);
    expect(prompt).toHaveAttribute("aria-activedescendant", options[0]!.id);
    fireEvent.keyDown(prompt, { key: "ArrowDown" });
    expect(prompt).toHaveAttribute("aria-activedescendant", options[1]!.id);
    // Enter during IME composition is the input method's, not the menu's.
    fireEvent.keyDown(prompt, { key: "Enter", isComposing: true });
    expect(prompt).toHaveValue("/");
    fireEvent.keyDown(prompt, { key: "Enter" });
    expect(prompt).toHaveValue("/ask ");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Remove Ask mode" }),
    ).toBeInTheDocument();
    expect(agentPosts()).toHaveLength(0);
  });

  it("closes the menu on Escape until a new trigger starts", async () => {
    stubFetch({});
    renderPanel();
    const prompt = await screen.findByLabelText("Prompt");
    type("/");
    await screen.findByRole("listbox");
    fireEvent.keyDown(prompt, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    type("/p");
    expect(screen.queryByRole("listbox")).toBeNull();
    type("");
    type("/");
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
  });

  it("does not send while an input method is composing", async () => {
    stubFetch({});
    renderPanel();
    const prompt = await screen.findByLabelText("Prompt");
    type("hello");
    await sendReady();
    fireEvent.keyDown(prompt, { key: "Enter", isComposing: true });
    fireEvent.keyDown(prompt, { key: "Enter", keyCode: 229 });
    expect(agentPosts()).toHaveLength(0);
  });

  it("runs a typed workspace command instead of starting a turn", async () => {
    stubFetch({});
    const context = agentContext();
    renderPanel({}, context);
    const prompt = await screen.findByLabelText("Prompt");
    type("/changes");
    await screen.findByRole("listbox");
    fireEvent.keyDown(prompt, { key: "Escape" });
    // With the menu closed, Enter still runs the command.
    fireEvent.keyDown(prompt, { key: "Enter" });
    await waitFor(() =>
      expect(context.controller.run).toHaveBeenCalledWith({
        type: "show_changes",
      }),
    );
    expect(prompt).toHaveValue("");
    expect(agentPosts()).toHaveLength(0);
  });

  it("runs a command with an argument from the Send button", async () => {
    stubFetch({});
    const context = agentContext();
    renderPanel({}, context);
    await screen.findByLabelText("Prompt");
    type("/rename Login flow");
    expect(
      await screen.findByRole("option", { name: /Rename this chat/ }),
    ).toBeInTheDocument();
    fireEvent.submit(screen.getByLabelText("Prompt").closest("form")!);
    await waitFor(() =>
      expect(context.controller.run).toHaveBeenCalledWith({
        type: "rename_chat",
        title: "Login flow",
      }),
    );
    expect(agentPosts()).toHaveLength(0);
  });

  it("lists worktrees, GitHub branches and a new branch for /branch", async () => {
    stubFetch({});
    const context = agentContext();
    renderPanel({}, context);
    await screen.findByLabelText("Prompt");
    type("/branch feat");
    expect(
      await screen.findByRole("option", { name: /Switch to feat\/login/ }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("option", { name: /Open feat\/remote/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /Create branch feat/ }));
    await waitFor(() =>
      expect(context.controller.run).toHaveBeenCalledWith({
        type: "create_branch",
        branch: "feat",
      }),
    );
  });

  it("explains a workspace command that needs an argument", async () => {
    stubFetch({});
    const context = agentContext();
    renderPanel({}, context);
    const prompt = await screen.findByLabelText("Prompt");
    type("/open");
    fireEvent.keyDown(prompt, { key: "Escape" });
    fireEvent.keyDown(prompt, { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Name a file to open",
    );
    expect(prompt).toHaveValue("/open");
    expect(context.controller.run).not.toHaveBeenCalled();
  });

  it("shows @label in the composer and sends a mention token", async () => {
    stubFetch({});
    const context = agentContext();
    renderPanel({}, context);
    await screen.findByLabelText("Prompt");
    type("Check @ap");
    fireEvent.click(
      await screen.findByRole("option", { name: /src\/api\.ts/ }),
    );
    expect(screen.getByLabelText("Prompt")).toHaveValue("Check @src/api.ts ");
    expect(
      screen.getByRole("button", { name: "Remove mention src/api.ts" }),
    ).toBeInTheDocument();
    type("Check @src/api.ts please");
    await sendReady();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(agentPosts()).toHaveLength(1));
    expect(agentPosts()[0]).toMatchObject({
      prompt: "Check @[src/api.ts](file:src%2Fapi.ts) please",
      workspaceContext: { ...SNAPSHOT, excerpts: [] },
    });
  });

  it("drops a mention whose label was edited away", async () => {
    stubFetch({});
    renderPanel({}, agentContext());
    await screen.findByLabelText("Prompt");
    type("@ap");
    fireEvent.click(
      await screen.findByRole("option", { name: /src\/api\.ts/ }),
    );
    type("@src/ap please");
    expect(
      screen.queryByRole("button", { name: "Remove mention src/api.ts" }),
    ).toBeNull();
  });

  it("sends the mentioned selection as an excerpt with that turn", async () => {
    stubFetch({});
    const selection = {
      path: "src/api.ts",
      startLine: 3,
      endLine: 5,
      text: "const a = 1;",
    };
    renderPanel({}, agentContext({ selection: () => selection }));
    await screen.findByLabelText("Prompt");
    type("@");
    fireEvent.click(
      await screen.findByRole("option", { name: /Selection \(api\.ts:3-5\)/ }),
    );
    type(
      `${(screen.getByLabelText("Prompt") as HTMLTextAreaElement).value}explain`,
    );
    await sendReady();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(agentPosts()).toHaveLength(1));
    expect(agentPosts()[0].prompt).toBe(
      "@[api.ts:3-5](selection:src%2Fapi.ts%23L3-5) explain",
    );
    expect(agentPosts()[0].workspaceContext.excerpts).toEqual([
      { kind: "selection", ref: "src/api.ts#L3-5", text: "const a = 1;" },
    ]);
  });

  it("switches the agent for one message without changing the chat's", async () => {
    stubFetch({
      allProviders: {
        codex: {
          connected: true,
          via: "api-key",
          models: [{ id: "gpt-5.6-luna", label: "GPT-5.6 Luna" }],
        },
        claude: {
          connected: true,
          via: "api-key",
          models: [{ id: "sonnet", label: "Sonnet" }],
        },
      },
    });
    const onActiveProviderChange = vi.fn();
    renderPanel(
      {
        activeProvider: "codex",
        connectedProviders: ["codex", "claude"],
        onActiveProviderChange,
      },
      agentContext(),
    );
    await screen.findByLabelText("Prompt");
    type("@cl");
    fireEvent.click(
      await screen.findByRole("option", {
        name: "Use Claude for this message",
      }),
    );
    expect(screen.getByText("→ Claude · Sonnet")).toBeInTheDocument();
    type("review the auth flow");
    await sendReady();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(agentPosts()).toHaveLength(1));
    expect(agentPosts()[0]).toMatchObject({
      provider: "claude",
      model: "sonnet",
    });
    expect(onActiveProviderChange).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Stop/ })).toBeNull(),
    );
    expect(screen.queryByText("→ Claude · Sonnet")).toBeNull();
    type("and the tests");
    await sendReady();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(agentPosts()).toHaveLength(2));
    expect(agentPosts()[1]).toMatchObject({ provider: "codex" });
  });

  it("queues one follow-up while a turn runs and sends it after", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubFetch({
      poll: () =>
        held.then(() => ({
          chunks: ndjson(
            `{"type":"item.completed","item":{"id":"m1","type":"agent_message","text":"Done."}}`,
            `{"type":"turn.completed"}`,
          ),
          nextSequence: 1,
          exited: true,
        })),
    });
    renderPanel();
    await screen.findByLabelText("Prompt");
    type("first");
    await sendReady();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("button", { name: /Stop/ });
    // Drafting stays open while the agent works; Enter queues.
    type("second");
    // The docked composer replaced the empty state's.
    fireEvent.keyDown(screen.getByLabelText("Prompt"), { key: "Enter" });
    expect(await screen.findByText("Queued")).toBeInTheDocument();
    expect(screen.getByLabelText("Prompt")).toHaveValue("");
    expect(agentPosts()).toHaveLength(1);
    release();
    await waitFor(() => expect(agentPosts()).toHaveLength(2));
    expect(agentPosts()[1].prompt).toBe("second");
  });

  it("gives a queued follow-up back when it is cancelled", async () => {
    stubFetch({ poll: () => new Promise(() => undefined) });
    renderPanel();
    await screen.findByLabelText("Prompt");
    type("first");
    await sendReady();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("button", { name: /Stop/ });
    type("second");
    fireEvent.keyDown(screen.getByLabelText("Prompt"), { key: "Enter" });
    fireEvent.click(
      await screen.findByRole("button", { name: "Cancel queued message" }),
    );
    expect(screen.getByLabelText("Prompt")).toHaveValue("second");
    expect(screen.queryByText("Queued")).toBeNull();
  });

  it("keeps the turn's action token for a rejoin", async () => {
    stubFetch({
      start: () =>
        Response.json({ sessionId: "session-1", actionNonce: "abcde12345" }),
      poll: () => new Promise(() => undefined),
    });
    renderPanel();
    await screen.findByLabelText("Prompt");
    type("open the app");
    await sendReady();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("button", { name: /Stop/ });
    await waitFor(() =>
      expect(
        JSON.parse(sessionStorage.getItem(`codev-gen2-turn:${workspace.id}`)!),
      ).toMatchObject({ sessionId: "session-1", actionNonce: "abcde12345" }),
    );
  });

  it("shows the chat goal and sends goal controls without polling", async () => {
    const history = [
      {
        id: "u-1",
        role: "user",
        body: "/goal Ship the login page",
        createdAt: "2026-09-20T20:00:00.000Z",
      },
      {
        id: "a-1",
        role: "assistant",
        body: "Started on it.",
        createdAt: "2026-09-20T20:01:00.000Z",
      },
    ];
    stubFetch({
      history,
      start: () => {
        history.push({
          id: "u-2",
          role: "user",
          body: "/goal done",
          createdAt: "2026-09-20T20:02:00.000Z",
        });
        return Response.json({
          goal: {
            text: "Ship the login page",
            status: "achieved",
            summary: null,
          },
        });
      },
    });
    renderPanel({ activeChatId: CHAT.id });
    const bar = await screen.findByRole("region", { name: "Chat goal" });
    expect(bar).toHaveTextContent("Ship the login page");
    expect(bar).toHaveTextContent("Active");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Mark done" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    await waitFor(() => expect(bar).toHaveTextContent("Achieved"));
    expect(agentPosts()[0].prompt).toBe("/goal done");
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) => String(url).endsWith("/agent/poll")),
    ).toBe(false);
  });

  it("offers next steps under a plan reply", async () => {
    stubFetch({
      history: [
        {
          id: "u-1",
          role: "user",
          body: "/plan add sign in",
          createdAt: "2026-09-20T20:00:00.000Z",
        },
        {
          id: "a-1",
          role: "assistant",
          body: "1. Add a route",
          createdAt: "2026-09-20T20:01:00.000Z",
        },
      ],
    });
    renderPanel({ activeChatId: CHAT.id });
    // The bubble shows the mode as a chip, not the raw command.
    expect(await screen.findByText("add sign in")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Refine plan" }));
    expect(screen.getByLabelText("Prompt")).toHaveValue("/plan ");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Implement this plan" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Implement this plan" }),
    );
    await waitFor(() => expect(agentPosts()).toHaveLength(1));
    expect(agentPosts()[0].prompt).toBe("Implement the plan above.");
  });

  it("recalls the last message with Up in an empty composer", async () => {
    stubFetch({
      history: [
        {
          id: "u-1",
          role: "user",
          body: "/plan Attached files on this machine:\n- `.codev/uploads/a.ts`\n\nfix @[src/a.ts](file:src%2Fa.ts)",
          createdAt: "2026-09-20T20:00:00.000Z",
        },
      ],
    });
    renderPanel({ activeChatId: CHAT.id });
    await screen.findByText(/fix/);
    const prompt = screen.getByLabelText("Prompt") as HTMLTextAreaElement;
    prompt.setSelectionRange(0, 0);
    fireEvent.keyDown(prompt, { key: "ArrowUp" });
    expect(prompt).toHaveValue("/plan fix @src/a.ts");
    expect(
      screen.getByRole("button", { name: "Remove mention src/a.ts" }),
    ).toBeInTheDocument();
  });

  it("prefills a handed-off draft once and consumes it", async () => {
    stubFetch({});
    const context = agentContext(
      {},
      {
        draftRequest: {
          id: "draft-1",
          text: "Continue from @[Old chat](chat:44444444-4444-4444-8444-444444444444) ",
        },
      },
    );
    renderPanel({}, context);
    await waitFor(() =>
      expect(screen.getByLabelText("Prompt")).toHaveValue(
        "Continue from @Old chat ",
      ),
    );
    expect(context.consumeDraftRequest).toHaveBeenCalledWith("draft-1");
    expect(agentPosts()).toHaveLength(0);
  });

  it("ranks empty-state cards from the workspace and fills, never sends", async () => {
    stubFetch({});
    renderPanel({ connectedProviders: ["codex"] }, agentContext());
    await screen.findByRole("heading", { name: "What should we build?" });
    expect(
      screen.getByText(
        /it can open files, review changes, create branches, and invite teammates\./,
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Review my 2 changed files/ }),
    );
    expect(screen.getByLabelText("Prompt")).toHaveValue("/review ");
    fireEvent.click(screen.getByRole("button", { name: /Invite teammates/ }));
    expect(screen.getByLabelText("Prompt")).toHaveValue("Invite ");
    expect(agentPosts()).toHaveLength(0);
  });

  it("explains instead of offering a composer to a viewer", async () => {
    stubFetch({});
    renderPanel({ workspace: { ...workspace, role: "viewer" } });
    expect(
      await screen.findByText(/You can view this workspace/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Prompt")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Plan before building/ }),
    ).toBeNull();
  });

  it("asks for a plan's text instead of sending an empty /plan", async () => {
    stubFetch({});
    renderPanel();
    const prompt = await screen.findByLabelText("Prompt");
    type("/plan ");
    await sendReady();
    fireEvent.keyDown(prompt, { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Add what to plan after /plan.",
    );
    expect(agentPosts()).toHaveLength(0);
    expect(prompt).toHaveValue("/plan ");
  });

  it("inserts dictated words into the prompt", async () => {
    const instances: Array<{
      onresult: ((event: unknown) => void) | null;
      start: () => void;
      stop: () => void;
      processLocally?: boolean;
    }> = [];
    class Recognition {
      static available = vi.fn(async () => "available");
      lang = "";
      continuous = false;
      interimResults = false;
      processLocally = false;
      onresult: ((event: unknown) => void) | null = null;
      onerror = null;
      onend = null;
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn();
      constructor() {
        instances.push(this);
      }
    }
    vi.stubGlobal("SpeechRecognition", Recognition);
    try {
      stubFetch({});
      renderPanel();
      const prompt = await screen.findByLabelText("Prompt");
      type("Please");
      const mic = screen.getByRole("button", { name: "Dictation" });
      expect(mic).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(mic);
      await waitFor(() => expect(instances).toHaveLength(1));
      expect(instances[0]!.processLocally).toBe(true);
      expect(mic).toHaveAttribute("aria-pressed", "true");
      const result = Object.assign([{ transcript: "fix the header" }], {
        isFinal: true,
      });
      act(() =>
        instances[0]!.onresult?.({ resultIndex: 0, results: [result] }),
      );
      expect(prompt).toHaveValue("Please fix the header");
      fireEvent.click(mic);
      expect(instances[0]!.stop).toHaveBeenCalled();
      expect(mic).toHaveAttribute("aria-pressed", "false");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
