import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathname,
}));

import { AppSidebarNav } from "./app-sidebar-nav";

describe("AppSidebarNav", () => {
  beforeEach(() => {
    mocks.usePathname.mockReturnValue("/import");
  });

  it("links to the chat import surface and marks it active", () => {
    render(<AppSidebarNav />);

    const link = screen.getByRole("link", { name: "Import chat" });
    expect(link).toHaveAttribute("href", "/import");
    expect(link).toHaveClass("is-active");
    expect(screen.getByRole("link", { name: "Rooms" })).toHaveAttribute(
      "href",
      "/rooms",
    );
  });
});
