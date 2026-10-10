import { describe, expect, it } from "vitest";

import { upsertChat, withSavedMessage } from "./use-chat-thread-events";

const message = (id: string) => ({
  id,
  role: "user" as const,
  body: "hello",
  items: null,
  authorUserId: null,
  createdAt: "2026-07-28T12:00:00.000Z",
});
const chat = (id: string, title = "Chat") => ({
  id,
  title,
  createdAt: "2026-07-28T12:00:00.000Z",
  updatedAt: "2026-07-28T12:00:00.000Z",
});

describe("chat thread events", () => {
  it("ignores an echo of a message the thread already holds", () => {
    expect(withSavedMessage([message("a")], message("a"))).toBeNull();
  });

  it("drops optimistic copies when the saved message arrives", () => {
    expect(
      withSavedMessage([message("a"), message("pending-1")], message("b"))?.map(
        (entry) => entry.id,
      ),
    ).toEqual(["a", "b"]);
  });

  it("moves an updated chat to the top without duplicating it", () => {
    expect(
      upsertChat([chat("a"), chat("b")], chat("b", "Renamed")).map(
        (entry) => `${entry.id}:${entry.title}`,
      ),
    ).toEqual(["b:Renamed", "a:Chat"]);
  });
});
