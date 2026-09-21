import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Gen2WorkspaceDetail } from "@codev/contracts";

import { Gen2ChatPanel } from "./chat-panel";

const workspace: Gen2WorkspaceDetail = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Studio",
  status: "ready",
  sandboxId: "sandbox-1",
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
    poll?: () => unknown | Promise<unknown>;
    messages?: unknown[];
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
        if (path.endsWith("/agent")) return json({ sessionId: "session-1" });
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
        if (path.endsWith("/chats")) {
          return init?.method === "POST"
            ? json({ chat: CHAT })
            : json({ chats: [CHAT] });
        }
        throw new Error(`unstubbed fetch: ${init?.method ?? "GET"} ${path}`);
      }),
    );
  }

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
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // The command card is on screen before the turn has finished.
    expect(await screen.findByText("ls")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Stop/ })).toBeInTheDocument();

    releaseFirstPoll?.();

    // The reply comes back from the reloaded thread, which the server wrote
    // as the turn exited -- the client never posts it.
    expect(await screen.findByText("Listed them.")).toBeInTheDocument();
    // The activity survives the turn because the server stored it too.
    expect(screen.getByText("ls")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not start/,
    );
    // Their words are not thrown away.
    expect(screen.getByLabelText("Prompt")).toHaveValue("do the thing");
  });
});
