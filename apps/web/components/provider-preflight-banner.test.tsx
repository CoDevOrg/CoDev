import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProviderPreflightBanner } from "./provider-preflight-banner";

describe("ProviderPreflightBanner", () => {
  it("names the agent about to run while starting, then goes away", () => {
    const preflight = { starting: "claude" as const, notReady: [] };
    const { rerender } = render(
      <ProviderPreflightBanner phase="starting" preflight={preflight} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Starting Claude…");

    rerender(<ProviderPreflightBanner phase="ready" preflight={preflight} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says a rooms-only agent cannot run here and how to fix it", () => {
    render(
      <ProviderPreflightBanner
        phase="starting"
        preflight={{
          starting: "codex",
          notReady: [{ agent: "claude", connectedForRooms: true }],
        }}
      />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Starting Codex.");
    expect(status).toHaveTextContent(
      "Claude is connected for chat rooms but not for coding workspaces",
    );
    expect(status).toHaveTextContent("codev claude-auth");
    expect(
      screen.getByRole("link", { name: "Open provider settings" }),
    ).toHaveAttribute("href", "/settings/personal/providers#coding-workspaces");
  });

  it("says when the workspace is running on its own shared login, not the member's", () => {
    render(
      <ProviderPreflightBanner
        phase="starting"
        preflight={{
          starting: "claude",
          startingSource: "shared",
          notReady: [],
        }}
      />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Starting Claude…");
    expect(status).toHaveTextContent(
      "Running on this workspace's shared Claude login — every member here can use it.",
    );
  });

  it("stays up once the workspace is ready when there is something to fix, until dismissed", () => {
    render(
      <ProviderPreflightBanner
        phase="ready"
        preflight={{ starting: null, notReady: [] }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "No agent is set up for coding workspaces yet.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
