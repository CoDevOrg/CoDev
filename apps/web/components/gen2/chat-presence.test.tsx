import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollaborationServerMessage } from "@codev/contracts";

import { ChatMessageAuthor } from "./chat-message-author";
import { ChatTypingIndicator } from "./chat-typing-indicator";
import {
  WorkspaceRealtimeContext,
  type RealtimeListener,
  type WorkspaceRealtime,
} from "./use-workspace-realtime";

const ME = "a010bd2c-a3c1-438f-acef-166287a3b1cb";
const SAM = "b010bd2c-a3c1-438f-acef-166287a3b1cb";
const CHAT = "c010bd2c-a3c1-438f-acef-166287a3b1cb";
const listeners = new Set<RealtimeListener>();

const realtime: WorkspaceRealtime = {
  enabled: true,
  status: "open",
  generation: 1,
  resyncToken: 0,
  connectionId: "c1",
  currentUserId: ME,
  me: null,
  presence: [],
  members: [
    { userId: ME, login: "me", name: "Me", role: "owner" },
    { userId: SAM, login: "sam", name: "Sam", role: "editor" },
  ],
  send: vi.fn(),
  listen: (listener) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};

const wrap = (children: ReactNode) => (
  <WorkspaceRealtimeContext.Provider value={realtime}>
    {children}
  </WorkspaceRealtimeContext.Provider>
);

const message = (id: string, authorUserId: string | null) => ({
  id,
  role: "user" as const,
  body: "hi",
  items: null,
  authorUserId,
  createdAt: "2026-07-28T12:00:00.000Z",
});

function push(
  event: Extract<CollaborationServerMessage, { type: "event" }>["event"],
) {
  act(() =>
    listeners.forEach((listener) =>
      listener({
        type: "event",
        event,
        streamId: "1-0",
        at: "2026-07-28T12:00:00.000Z",
      }),
    ),
  );
}

afterEach(() => vi.useRealTimers());

describe("chat authorship", () => {
  it("names another member once per run, never you or older messages", () => {
    const { rerender, container } = render(
      wrap(
        <ChatMessageAuthor message={message("1", SAM)} previous={undefined} />,
      ),
    );
    expect(screen.getByText("Sam")).toBeInTheDocument();
    rerender(
      wrap(
        <ChatMessageAuthor
          message={message("2", SAM)}
          previous={message("1", SAM)}
        />,
      ),
    );
    expect(container).toBeEmptyDOMElement();
    rerender(
      wrap(
        <ChatMessageAuthor message={message("3", ME)} previous={undefined} />,
      ),
    );
    expect(container).toBeEmptyDOMElement();
    rerender(
      wrap(
        <ChatMessageAuthor message={message("4", null)} previous={undefined} />,
      ),
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("typing indicator", () => {
  it("shows who is typing in this chat and lapses after a pause", () => {
    vi.useFakeTimers();
    render(wrap(<ChatTypingIndicator chatId={CHAT} />));
    push({ kind: "typing", chatId: CHAT, userId: SAM });
    expect(screen.getByText("Sam is typing…")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.queryByText("Sam is typing…")).toBeNull();
  });

  it("ignores your own tabs and other chats", () => {
    render(wrap(<ChatTypingIndicator chatId={CHAT} />));
    push({ kind: "typing", chatId: CHAT, userId: ME });
    push({ kind: "typing", chatId: SAM, userId: SAM });
    expect(screen.queryByText(/typing/)).toBeNull();
  });
});
