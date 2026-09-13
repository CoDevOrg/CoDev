import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHANNEL_MESSAGE_POLL_MS } from "@/lib/team-chat-view";

import {
  mergeRoomMessages,
  SharedChatTranscript,
} from "./shared-chat-transcript";

const initialMessage = {
  sequence: 0,
  role: "user" as const,
  authorName: "Qais",
  text: "Initial message",
  sourceContentType: "text",
  createdAt: null,
  artifacts: [],
};

const liveMessage = {
  sequence: 1,
  role: "user" as const,
  authorName: "Jordan",
  text: "Message from another member",
  sourceContentType: "text",
  createdAt: "2026-09-02T12:01:00.000Z",
  artifacts: [],
};

describe("SharedChatTranscript", () => {
  it("revisits pending replies even when later human messages exist", async () => {
    const pending = {
      ...initialMessage,
      sequence: 1,
      role: "assistant" as const,
      authorName: "Claude",
      text: "",
      generation: {
        provider: "claude" as const,
        model: "m",
        status: "pending" as const,
      },
    };
    const finished = {
      ...pending,
      text: "The answer",
      generation: { ...pending.generation, status: "completed" },
    };
    const later = { ...liveMessage, sequence: 2 };
    const fetchMock = vi.fn(async (url: string) =>
      Response.json(
        url.endsWith("reply-options")
          ? { options: [] }
          : { messages: [finished, later] },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <SharedChatTranscript
        roomId="room-123"
        initialMessages={[initialMessage, pending, later]}
      />,
    );
    expect(screen.getByText("Claude is replying…")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHANNEL_MESSAGE_POLL_MS);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/rooms/room-123/messages?after=0",
      expect.anything(),
    );
    expect(screen.queryByText("Claude is replying…")).not.toBeInTheDocument();
    expect(screen.getAllByText("The answer")).toHaveLength(1);
  });
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("polls from the latest sequence and displays another member's message", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) =>
      url.endsWith("reply-options")
        ? Response.json({ options: [] })
        : new Response(JSON.stringify({ messages: [liveMessage] }), {
            status: 200,
          }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <SharedChatTranscript
        roomId="room-123"
        initialMessages={[initialMessage]}
      />,
    );

    expect(screen.queryByText(liveMessage.text)).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHANNEL_MESSAGE_POLL_MS);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/rooms/room-123/messages?after=0",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(screen.getByText(liveMessage.text)).toBeInTheDocument();
  });

  it("deduplicates messages by transcript sequence", () => {
    expect(
      mergeRoomMessages([initialMessage], [initialMessage, liveMessage]),
    ).toEqual([initialMessage, liveMessage]);
  });
});
