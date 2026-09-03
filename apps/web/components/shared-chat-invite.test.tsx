import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SharedChatInvite } from "./shared-chat-invite";

describe("SharedChatInvite", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates and copies a room invite link", async () => {
    const inviteUrl = "https://codev.test/room-invites/invite-token";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ inviteUrl }), { status: 201 }),
        ),
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<SharedChatInvite roomId="room-123" />);

    fireEvent.click(screen.getByRole("button", { name: "Invite people" }));

    expect(await screen.findByText(inviteUrl)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(inviteUrl));
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("shows a safe API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Invite limit reached." }), {
          status: 429,
        }),
      ),
    );
    render(<SharedChatInvite roomId="room-123" />);

    fireEvent.click(screen.getByRole("button", { name: "Invite people" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invite limit reached.",
    );
  });
});
