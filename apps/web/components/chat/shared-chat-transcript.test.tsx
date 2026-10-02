import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  mergeRoomMessages,
  ROOM_TRANSCRIPT_POLL_MS,
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
      await vi.advanceTimersByTimeAsync(ROOM_TRANSCRIPT_POLL_MS);
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
      await vi.advanceTimersByTimeAsync(ROOM_TRANSCRIPT_POLL_MS);
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

  describe("a reply streaming in", () => {
    const generation = {
      status: "pending" as const,
      provider: "claude" as const,
      model: "sonnet",
    };
    const streaming = (text: string) => ({
      ...liveMessage,
      role: "assistant" as const,
      text,
      generation,
    });

    it("keeps live partial text when a poll returns the empty placeholder", () => {
      // Postgres holds `body: ""` until the turn commits, so the polling
      // fallback must not be allowed to blank out what SSE already delivered.
      expect(
        mergeRoomMessages([streaming("Half a th")], [streaming("")]),
      ).toEqual([streaming("Half a th")]);
    });

    it("accepts each longer partial", () => {
      expect(
        mergeRoomMessages(
          [streaming("Half a th")],
          [streaming("Half a thought")],
        ),
      ).toEqual([streaming("Half a thought")]);
    });

    it("always accepts the committed reply, even when it is shorter", () => {
      const completed = {
        ...streaming("Trimmed."),
        generation: { ...generation, status: "completed" as const },
      };
      expect(
        mergeRoomMessages([streaming("A much longer draft")], [completed]),
      ).toEqual([completed]);
    });
  });
});
