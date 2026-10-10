import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { PresenceAgent, PresencePerson } from "./use-workspace-presence";
import { WorkspacePresenceStack } from "./workspace-presence-stack";

function person(
  index: number,
  overrides: Partial<PresencePerson> = {},
): PresencePerson {
  const id = `0000000${index}-a3c1-438f-acef-166287a3b1cb`;
  return {
    userId: id,
    user: { id, login: `user${index}`, name: `User ${index}`, avatarUrl: null },
    role: "editor",
    isSelf: false,
    away: false,
    worktreeId: "main",
    path: null,
    view: "chat",
    chatId: null,
    ...overrides,
  };
}

const agent: PresenceAgent = {
  sessionId: "s1",
  provider: "claude",
  chatId: "c",
  owner: { id: "o", login: "alex", name: "Alex", avatarUrl: null },
  worktreeId: "feature",
  path: "src/app.ts",
  cursor: null,
};

function renderStack(
  props: Partial<Parameters<typeof WorkspacePresenceStack>[0]>,
) {
  return render(
    <TooltipProvider>
      <WorkspacePresenceStack
        people={[]}
        agents={[]}
        branchFor={(id) => (id === "feature" ? "feature-x" : id)}
        {...props}
      />
    </TooltipProvider>,
  );
}

describe("WorkspacePresenceStack", () => {
  it("renders nothing when you are alone", () => {
    const { container } = renderStack({
      people: [person(1, { isSelf: true })],
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("names others and agents with where they are, and follows on click", () => {
    const onFollow = vi.fn();
    renderStack({
      people: [person(1, { path: "src/index.ts", view: "files" })],
      agents: [agent],
      onFollow,
    });
    expect(
      screen.getByRole("button", {
        name: "User 1, Editor · main · editing index.ts. Follow",
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Claude · Alex’s turn, feature-x · editing app.ts/,
      }),
    );
    expect(onFollow).toHaveBeenCalledWith({ kind: "agent", sessionId: "s1" });
  });

  it("collapses extra avatars behind a count", () => {
    renderStack({ people: [1, 2, 3, 4, 5, 6].map((index) => person(index)) });
    expect(
      screen.getByRole("button", { name: "Show all 6 people and agents" }),
    ).toHaveTextContent("+2");
  });
});
