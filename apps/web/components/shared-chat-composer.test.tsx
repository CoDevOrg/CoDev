import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SharedChatComposer } from "./shared-chat-composer";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

describe("SharedChatComposer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    refresh.mockReset();
  });

  it("posts a trimmed message and refreshes the room", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: { id: "message-1" } }), {
        status: 201,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<SharedChatComposer roomId="room-123" />);

    fireEvent.change(screen.getByLabelText("Add to the conversation"), {
      target: { value: "  A new thought  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
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
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Only the owner can post." }), {
          status: 403,
        }),
      ),
    );
    render(<SharedChatComposer roomId="room-123" />);

    fireEvent.change(screen.getByLabelText("Add to the conversation"), {
      target: { value: "Keep this draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only the owner can post.",
    );
    expect(screen.getByLabelText("Add to the conversation")).toHaveValue(
      "Keep this draft",
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
