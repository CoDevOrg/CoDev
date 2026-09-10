import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SharedChatComposer } from "./shared-chat-composer";

describe("SharedChatComposer", () => {
  it("selects a provider and model and adds both persisted messages", async () => {
    const message = {
      sequence: 2,
      role: "user",
      authorName: "Qais",
      text: "Continue",
      sourceContentType: "text",
      createdAt: null,
      artifacts: [],
    };
    const reply = {
      ...message,
      sequence: 3,
      role: "assistant",
      authorName: "Codex",
      text: "",
      generation: { provider: "codex", model: "codex-two", status: "pending" },
    };
    const fetchMock = vi.fn(async (url: string) =>
      Response.json(
        url.endsWith("reply-options")
          ? {
              options: [
                { provider: "claude", models: ["claude-one"] },
                { provider: "codex", models: ["codex-one", "codex-two"] },
              ],
            }
          : { message, reply },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onMessageSent = vi.fn();
    render(
      <SharedChatComposer roomId="room-123" onMessageSent={onMessageSent} />,
    );
    fireEvent.change(await screen.findByLabelText("Provider"), {
      target: { value: "codex" },
    });
    expect(screen.getByLabelText("Model")).toHaveValue("codex-one");
    fireEvent.change(screen.getByLabelText("Model"), {
      target: { value: "codex-two" },
    });
    fireEvent.change(screen.getByLabelText("Add to the conversation"), {
      target: { value: "Continue" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
    await waitFor(() => expect(onMessageSent).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/rooms/room-123/messages",
      expect.objectContaining({
        body: JSON.stringify({
          body: "Continue",
          reply: { provider: "codex", model: "codex-two" },
        }),
      }),
    );
    expect(onMessageSent).toHaveBeenLastCalledWith(reply);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts a trimmed message and adds it to the live transcript", async () => {
    const message = {
      sequence: 2,
      role: "user",
      authorName: "Qais",
      text: "A new thought",
      sourceContentType: "text",
      createdAt: "2026-09-02T12:00:00.000Z",
      artifacts: [],
    };
    const fetchMock = vi.fn().mockImplementation(async (url: string) =>
      url.endsWith("reply-options")
        ? Response.json({ options: [] })
        : new Response(JSON.stringify({ message }), {
            status: 201,
          }),
    );
    const onMessageSent = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <SharedChatComposer roomId="room-123" onMessageSent={onMessageSent} />,
    );

    fireEvent.change(screen.getByLabelText("Add to the conversation"), {
      target: { value: "  A new thought  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() => expect(onMessageSent).toHaveBeenCalledWith(message));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/rooms/room-123/messages",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ body: "A new thought" }),
      }),
    );
    expect(screen.getByLabelText("Add to the conversation")).toHaveValue("");
  });

  it("keeps the draft and shows a safe API error when sending fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) =>
        url.endsWith("reply-options")
          ? Response.json({ options: [] })
          : new Response(
              JSON.stringify({ error: "Only the owner can post." }),
              {
                status: 403,
              },
            ),
      ),
    );
    const onMessageSent = vi.fn();
    render(
      <SharedChatComposer roomId="room-123" onMessageSent={onMessageSent} />,
    );

    fireEvent.change(screen.getByLabelText("Add to the conversation"), {
      target: { value: "Keep this draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only the owner can post.",
    );
    expect(screen.getByLabelText("Add to the conversation")).toHaveValue(
      "Keep this draft",
    );
    expect(onMessageSent).not.toHaveBeenCalled();
  });
});
