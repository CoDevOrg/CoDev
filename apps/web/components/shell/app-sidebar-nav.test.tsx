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
    expect(screen.getByRole("link", { name: "Gen 2" })).toHaveAttribute(
      "href",
      "/gen2",
    );
  });

  it("sends non-admin navigation to the public host from the admin host", () => {
    render(<AppSidebarNav showAdmin isAdminHost />);

    expect(screen.getByRole("link", { name: "Workspaces" })).toHaveAttribute(
      "href",
      "https://www.trycodev.com/dashboard",
    );
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute(
      "href",
      "https://admins.trycodev.com",
    );
  });
});
