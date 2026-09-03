import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AcceptRoomInvite } from "./accept-room-invite";

const router = { push: vi.fn(), refresh: vi.fn() };

vi.mock("next/navigation", () => ({ useRouter: () => router }));

describe("AcceptRoomInvite", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    router.push.mockReset();
    router.refresh.mockReset();
  });

  it("accepts the invitation and opens the room", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ roomId: "room-123" }), { status: 200 }),
        ),
    );
    render(<AcceptRoomInvite token="invite-token" />);

    fireEvent.click(screen.getByRole("button", { name: "Join room" }));

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/rooms/room-123"),
    );
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("shows an invalid invite error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "This invite has expired." }), {
          status: 400,
        }),
      ),
    );
    render(<AcceptRoomInvite token="expired-token" />);

    fireEvent.click(screen.getByRole("button", { name: "Join room" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This invite has expired.",
    );
    expect(router.push).not.toHaveBeenCalled();
  });
});
