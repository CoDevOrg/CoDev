import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Gen2TurnItem, Gen2WorkspaceAction } from "@codev/contracts";

import {
  readWorkspaceActionOutcome,
  useWorkspaceActionDispatch,
} from "./use-workspace-action-dispatch";
import { isWorkspaceNavigation } from "./workspace-action-blocker";
import {
  WorkspaceAgentContext,
  type WorkspaceAgentContextValue,
  type WorkspaceController,
} from "./workspace-controller";

const NONCE = "k3y9q2m4x7";
const WORKSPACE = "ws-1";
const CHAT = "chat-1";

function item(
  id: string,
  action: Gen2WorkspaceAction | null,
  token: string | null = NONCE,
): Gen2TurnItem {
  return {
    id,
    kind: "workspaceAction",
    status: "completed",
    token,
    action,
    error: action ? null : "Invalid JSON.",
  };
}

const OPEN = { type: "open_file", path: "src/app.ts" } as const;
const INVITE: Gen2WorkspaceAction = {
  type: "invite_members",
  people: ["ada"],
  role: "editor",
};

function setup(blocker?: (action: Gen2WorkspaceAction) => string | null) {
  const controller = {
    autoRunBlocker: vi.fn(
      blocker ??
        ((action: Gen2WorkspaceAction) =>
          isWorkspaceNavigation(action) ? null : "Waits for you to confirm"),
    ),
    run: vi.fn(async () => ({ ok: true, message: "Done" })),
    newChat: vi.fn(),
    openSettings: vi.fn(),
    openImport: vi.fn(),
    setViewMode: vi.fn(),
  } satisfies WorkspaceController;
  const value = { controller } as unknown as WorkspaceAgentContextValue;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WorkspaceAgentContext.Provider value={value}>
      {children}
    </WorkspaceAgentContext.Provider>
  );
  return { controller, wrapper };
}

type Props = {
  items: Gen2TurnItem[] | null;
  chatId?: string;
  nonce?: string | null;
};

function render(initial: Props, wrapper: ReturnType<typeof setup>["wrapper"]) {
  return renderHook(
    ({ items, chatId = CHAT, nonce = NONCE }: Props) =>
      useWorkspaceActionDispatch({
        workspaceId: WORKSPACE,
        chatId,
        live: items ? { sessionId: "s1", actionNonce: nonce, items } : null,
      }),
    { initialProps: initial, wrapper },
  );
}

describe("useWorkspaceActionDispatch", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("runs the turn's own navigation once, even across a remount", async () => {
    const { controller, wrapper } = setup();
    const items = [item("m1:action:0", OPEN)];
    const first = render({ items }, wrapper);
    first.rerender({ items: [...items] });
    await waitFor(() =>
      expect(first.result.current.announcement).toBe(
        "Agent opened src/app.ts in Files",
      ),
    );
    first.unmount();
    render({ items }, wrapper);
    expect(controller.run).toHaveBeenCalledTimes(1);
    expect(readWorkspaceActionOutcome(CHAT, items[0]!)).toEqual({
      state: "auto",
      message: "Done",
    });
  });

  it("never acts on a block without the turn's nonce, or an invalid one", () => {
    const { controller, wrapper } = setup();
    const { result } = render(
      {
        items: [
          item("m1:action:0", OPEN, "wrongtoken"),
          item("m1:action:1", INVITE, null),
          item("m1:action:2", null),
        ],
      },
      wrapper,
    );
    const noNonce = render(
      { items: [item("m2:action:0", OPEN)], nonce: null },
      wrapper,
    );
    expect(controller.run).not.toHaveBeenCalled();
    expect(result.current.pending).toEqual([]);
    expect(noNonce.result.current.pending).toEqual([]);
  });

  it("holds proposals for the chat, across a reload, until resolved", () => {
    const { controller, wrapper } = setup();
    const items = [item("m1:action:0", INVITE)];
    const first = render({ items }, wrapper);
    expect(controller.run).not.toHaveBeenCalled();
    expect(first.result.current.pending).toEqual([
      expect.objectContaining({
        key: "s1:m1:action:0",
        chatId: CHAT,
        action: INVITE,
        blocker: "Waits for you to confirm",
      }),
    ]);
    first.unmount();

    const other = render({ items: null, chatId: "chat-2" }, wrapper);
    expect(other.result.current.pending).toEqual([]);
    const reloaded = render({ items: null }, wrapper);
    expect(reloaded.result.current.pending).toHaveLength(1);

    act(() =>
      reloaded.result.current.resolve("s1:m1:action:0", "done", "Invited 1"),
    );
    expect(reloaded.result.current.pending).toEqual([]);
    expect(readWorkspaceActionOutcome(CHAT, items[0]!)).toEqual({
      state: "done",
      message: "Invited 1",
    });
    // A reused item id with a different action does not inherit it.
    const reused = item("m1:action:0", {
      type: "invite_members",
      people: ["bob"],
      role: "editor",
    });
    expect(readWorkspaceActionOutcome(CHAT, reused)).toBeNull();
  });

  it("opens a deferred preview once its command runs", async () => {
    const { controller, wrapper } = setup((action) =>
      action.type === "open_preview"
        ? "Nothing is listening on :3000 yet"
        : isWorkspaceNavigation(action)
          ? null
          : "Waits for you to confirm",
    );
    const preview = { type: "open_preview", port: 3000 } as const;
    const command = {
      type: "run_in_terminal",
      command: "npm run dev",
    } as const;
    const { result } = render(
      { items: [item("m1:action:0", command), item("m1:action:1", preview)] },
      wrapper,
    );
    expect(result.current.pending.map((entry) => entry.blocker)).toEqual([
      "Waits for you to confirm",
      "Opens after you run the command",
    ]);
    act(() => result.current.resolve("s1:m1:action:0", "done"));
    await waitFor(() => expect(controller.run).toHaveBeenCalledWith(preview));
    expect(result.current.pending).toEqual([]);
  });

  it("offers navigation that failed to run as a request", async () => {
    const { controller, wrapper } = setup();
    controller.run.mockResolvedValueOnce({
      ok: false,
      message: "No such file",
    });
    const { result } = render({ items: [item("m1:action:0", OPEN)] }, wrapper);
    await waitFor(() =>
      expect(result.current.pending).toEqual([
        expect.objectContaining({ action: OPEN, blocker: "No such file" }),
      ]),
    );
  });

  it("does nothing outside the workspace", () => {
    const { result } = renderHook(() =>
      useWorkspaceActionDispatch({
        workspaceId: WORKSPACE,
        chatId: CHAT,
        live: { sessionId: "s1", actionNonce: NONCE, items: [item("a", OPEN)] },
      }),
    );
    expect(result.current.pending).toEqual([]);
    expect(result.current.announcement).toBe("");
  });
});
