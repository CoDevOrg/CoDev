import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Gen2WorkspaceDetail } from "@codev/contracts";

import { Gen2ChatPanel } from "./chat-panel";

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

describe("Gen2ChatPanel", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  function stubFetch(handlers: {
    start?: () => Response | Promise<Response>;
    poll?: () => unknown | Promise<unknown>;
    messages?: unknown[];
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
              messages: turnFinished ? (handlers.messages ?? []) : [],
            },
          });
        }
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

  it("fills the prompt from an empty-state suggestion without sending", async () => {
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
      screen.getByRole("button", { name: /Scaffold Next.js App/ }),
    );
    expect(screen.getByLabelText("Prompt")).toHaveValue(
      "Scaffold a small Next.js app",
    );
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
});
