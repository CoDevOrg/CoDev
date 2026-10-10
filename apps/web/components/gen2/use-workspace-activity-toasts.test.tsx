import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { useWorkspaceActivityToasts } from "./use-workspace-activity-toasts";
import type { PresencePerson } from "./use-workspace-presence";

const person = (id: string, isSelf = false): PresencePerson => ({
  userId: id,
  user: { id, login: id, name: id.toUpperCase(), avatarUrl: null },
  role: "editor",
  isSelf,
  away: false,
  worktreeId: "main",
  path: null,
  view: "chat",
  chatId: null,
});

function render(people: PresencePerson[]) {
  return renderHook(
    (props: { people: PresencePerson[] }) =>
      useWorkspaceActivityToasts({
        people: props.people,
        currentChatId: null,
        branchFor: (id) => id,
        onViewChanges: vi.fn(),
      }),
    { initialProps: { people } },
  );
}

describe("useWorkspaceActivityToasts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("announces arrivals, not the people already here", () => {
    const { rerender } = render([person("me", true), person("sam")]);
    expect(mocks.toast).not.toHaveBeenCalled();
    rerender({ people: [person("me", true), person("sam"), person("alex")] });
    expect(mocks.toast).toHaveBeenCalledWith("ALEX joined");
    expect(mocks.toast).toHaveBeenCalledTimes(1);
  });
});
