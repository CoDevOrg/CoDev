import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Gen2ChatMessage } from "@codev/contracts";

import { useChatMentionItems } from "./use-chat-mention-items";
import type { ComposerTrigger } from "./use-composer-typeahead";
import type { WorkspaceAgentContextValue } from "./workspace-controller";

const trigger = (query: string): ComposerTrigger => ({
  kind: "mention",
  start: 0,
  end: query.length + 1,
  query,
  command: null,
});

function context(
  sources: Partial<WorkspaceAgentContextValue["sources"]> = {},
): WorkspaceAgentContextValue {
  return {
    sources: {
      chats: [],
      activeChatId: null,
      worktreeId: "main",
      agentRuns: [],
      refreshRuns: vi.fn(),
      listFiles: vi.fn(async () => [
        { path: "src/app.ts", kind: "file" as const, size: 1 },
        { path: "src", kind: "directory" as const },
      ]),
      invalidateFiles: vi.fn(),
      selection: () => null,
      terminalTail: () => null,
      ...sources,
    },
  } as unknown as WorkspaceAgentContextValue;
}

function render(
  query: string,
  agentContext: WorkspaceAgentContextValue | null,
  messages: Gen2ChatMessage[] = [],
) {
  return renderHook(() =>
    useChatMentionItems({
      trigger: trigger(query),
      agentContext,
      chatId: "current",
      messages,
      agent: "codex",
      connectedProviders: ["codex", "claude"],
    }),
  );
}

const labels = (items: Array<{ label: string }>) =>
  items.map((item) => item.label);

describe("useChatMentionItems", () => {
  it("offers nothing outside the workspace shell", () => {
    expect(render("", null).result.current).toEqual([]);
  });

  it("pins the selection and terminal, then files, chats and agents", async () => {
    const agentContext = context({
      selection: () => ({
        path: "src/app.ts",
        startLine: 2,
        endLine: 4,
        text: "x",
      }),
      terminalTail: () => ({ worktreeId: "main", text: "npm ERR!" }),
      chats: [
        {
          id: "current",
          title: "This chat",
          createdAt: "",
          updatedAt: "2026-09-03T00:00:00.000Z",
        },
        {
          id: "old",
          title: "Old chat",
          provider: "claude",
          createdAt: "",
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
        {
          id: "busy",
          title: "Busy chat",
          provider: "codex",
          createdAt: "",
          updatedAt: "2026-09-02T00:00:00.000Z",
        },
      ],
      agentRuns: [
        {
          id: "run-1",
          chatId: "busy",
          provider: "codex",
          status: "running",
          worktreeId: "fix",
          branch: "fix/login",
        },
      ],
    });
    const { result } = render("", agentContext);
    await waitFor(() =>
      expect(result.current[0]?.label).toBe("Selection (app.ts:2-4)"),
    );
    expect(labels(result.current)).toEqual([
      "Selection (app.ts:2-4)",
      "Terminal output",
      "src",
      "src/app.ts",
      "Busy chat",
      "Old chat",
      "Use Claude for this message",
      "Connect Cursor…",
    ]);
    expect(agentContext.sources.refreshRuns).toHaveBeenCalledTimes(1);
    const selection = result.current[0]!;
    expect(selection.action).toEqual({
      type: "mention",
      mention: {
        kind: "selection",
        ref: "src/app.ts#L2-4",
        label: "app.ts:2-4",
        excerpt: "x",
      },
    });
    const busy = result.current.find((item) => item.label === "Busy chat")!;
    expect(busy).toMatchObject({
      detail: "Running · fix/login",
      provider: "codex",
    });
    expect(busy.action).toMatchObject({
      mention: { kind: "agent", ref: "run-1" },
    });
  });

  it("lists files this chat changed first", async () => {
    const messages = [
      {
        id: "a-1",
        role: "assistant",
        body: "",
        createdAt: "",
        items: [
          {
            id: "f",
            kind: "fileChange",
            status: "completed",
            changes: [{ path: "lib/zeta.ts", change: "modify" }],
          },
        ],
      },
    ] as unknown as Gen2ChatMessage[];
    const { result } = render("", context(), messages);
    await waitFor(() => expect(labels(result.current)).toContain("src/app.ts"));
    expect(result.current[0]).toMatchObject({
      label: "lib/zeta.ts",
      detail: "Changed in this chat",
    });
  });

  it("offers the typed path when the file list is unavailable", async () => {
    const { result } = render(
      "docs/plan.md",
      context({ listFiles: vi.fn(async () => null) }),
    );
    await waitFor(() =>
      expect(labels(result.current)).toEqual([
        "Mention docs/plan.md as a path",
      ]),
    );
  });
});
