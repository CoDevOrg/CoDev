import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProviderPreflightBanner } from "./provider-preflight-banner";

describe("ProviderPreflightBanner", () => {
  it("stays out of the way while the workspace is starting", () => {
    const preflight = { starting: "claude" as const, notReady: [] };
    const { rerender } = render(
      <ProviderPreflightBanner phase="starting" preflight={preflight} />,
    );
    expect(screen.queryByRole("status")).toBeNull();

    rerender(<ProviderPreflightBanner phase="ready" preflight={preflight} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says a rooms-only agent cannot run here and how to fix it", () => {
    render(
      <ProviderPreflightBanner
        phase="ready"
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
    expect(screen.getByRole("link", { name: "Set up agent" })).toHaveAttribute(
      "href",
      "/settings/personal/providers#coding-workspaces",
    );
  });

  it("does not keep non-actionable startup information after loading", () => {
    render(
      <ProviderPreflightBanner
        phase="ready"
        preflight={{
          starting: "claude",
          startingSource: "shared",
          notReady: [],
        }}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("leaves first-visit setup to the IDE instead of linking out of the workspace", () => {
    render(
      <ProviderPreflightBanner
        phase="ready"
        preflight={{ starting: null, notReady: [] }}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("leaves a rooms-only gap to the IDE when nothing can run here yet", () => {
    render(
      <ProviderPreflightBanner
        phase="ready"
        preflight={{
          starting: null,
          notReady: [{ agent: "claude", connectedForRooms: true }],
        }}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});
