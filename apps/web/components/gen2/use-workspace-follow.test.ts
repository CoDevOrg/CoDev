import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PresencePerson } from "./use-workspace-presence";
import { useWorkspaceFollow } from "./use-workspace-follow";

const SAM = "b010bd2c-a3c1-438f-acef-166287a3b1cb";
const sam = (overrides: Partial<PresencePerson> = {}): PresencePerson => ({
  userId: SAM,
  user: { id: SAM, login: "sam", name: "Sam", avatarUrl: null },
  role: "editor",
  isSelf: false,
  away: false,
  worktreeId: "main",
  path: "src/app.ts",
  view: "files",
  chatId: null,
  ...overrides,
});

function setup(dirty = false, person = sam()) {
  const actions = {
    selectWorktree: vi.fn(),
    openFile: vi.fn(),
    showTab: vi.fn(),
    selectChat: vi.fn(),
    onStopped: vi.fn(),
  };
  const hook = renderHook(
    (props: { person: PresencePerson }) =>
      useWorkspaceFollow({
        people: [props.person],
        agents: [],
        worktreeId: "main",
        dirty,
        ...actions,
      }),
    { initialProps: { person } },
  );
  return { ...hook, actions };
}

describe("useWorkspaceFollow", () => {
  it("opens what the followed member opens", () => {
    const { result, rerender, actions } = setup();
    act(() => result.current.follow({ kind: "person", userId: SAM }));
    expect(actions.openFile).toHaveBeenCalledWith("src/app.ts");
    rerender({ person: sam({ path: "src/next.ts" }) });
    expect(actions.openFile).toHaveBeenLastCalledWith("src/next.ts");
    expect(result.current.position?.label).toBe("Sam");
  });

  it("stops instead of leaving unsaved work behind", async () => {
    const { result, actions } = setup(true, sam({ worktreeId: "feature" }));
    await act(async () =>
      result.current.follow({ kind: "person", userId: SAM }),
    );
    expect(actions.selectWorktree).not.toHaveBeenCalled();
    expect(actions.onStopped).toHaveBeenCalled();
    expect(result.current.target).toBeNull();
  });

  it("stops on the member's own input, and on Escape", () => {
    const { result } = setup();
    const shell = document.createElement("div");
    shell.className = "gen2-ide-container";
    document.body.appendChild(shell);
    act(() => result.current.follow({ kind: "person", userId: SAM }));
    act(() => {
      shell.dispatchEvent(new Event("wheel", { bubbles: true }));
    });
    // Synthetic events are not the member's input.
    expect(result.current.target).not.toBeNull();
    act(() => result.current.stop());
    expect(result.current.position).toBeNull();
    shell.remove();
  });
});
