import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceShareButton } from "./workspace-share-button";

describe("WorkspaceShareButton", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders nothing for non-owners", () => {
    const { container } = render(
      <WorkspaceShareButton
        workspaceId="ws-1"
        canShare={false}
        isOwner={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("copies an invite link and shows a success toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ inviteUrl: "https://codev.example/invite/abc" }),
      }),
    );
    vi.stubGlobal("navigator", {
      clipboard: { writeText },
    });

    render(<WorkspaceShareButton workspaceId="ws-1" canShare isOwner />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() => {
      expect(
        screen.getByText("Invite link copied — share it to collaborate."),
      ).toBeInTheDocument();
    });
    expect(writeText).toHaveBeenCalledWith("https://codev.example/invite/abc");
  });

  it("shows an error toast when invite creation fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Invite rate limited." }),
      }),
    );
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn() },
    });

    render(<WorkspaceShareButton workspaceId="ws-1" canShare isOwner />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Invite rate limited.",
      );
    });
  });
});
