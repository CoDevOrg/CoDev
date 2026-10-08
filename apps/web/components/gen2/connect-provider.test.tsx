import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Gen2ConnectProvider } from "./connect-provider";

describe("Gen2ConnectProvider", () => {
  it("connects Claude from inside the workspace when settings can open there", () => {
    const onOpenSettings = vi.fn();
    render(
      <Gen2ConnectProvider
        agent="claude"
        onConnected={vi.fn()}
        onOpenSettings={onOpenSettings}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect Claude" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("falls back to the settings page without an in-workspace dialog", () => {
    render(<Gen2ConnectProvider agent="cursor" onConnected={vi.fn()} />);

    expect(
      screen.getByRole("link", { name: "Connect Cursor in settings" }),
    ).toHaveAttribute("href", "/settings/personal/providers");
    expect(
      screen.getByRole("button", { name: "I’ve connected it" }),
    ).toBeInTheDocument();
  });
});
