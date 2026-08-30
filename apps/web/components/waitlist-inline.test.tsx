import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WaitlistInline } from "./waitlist-inline";

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((media: string) => ({
      matches,
      media,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("WaitlistInline", () => {
  beforeEach(() => {
    // No fine pointer / no reduced motion: keeps the ghost-cursor overlay and
    // its IntersectionObserver out of the jsdom run.
    mockMatchMedia(false);
  });

  it("starts collapsed with the signup form held inert", () => {
    const { container } = render(<WaitlistInline />);

    const toggle = container.querySelector(".lp-waitlist-toggle")!;
    expect(toggle).toHaveTextContent("Join the waitlist");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    expect(container.querySelector(".lp-waitlist-drawer")).not.toHaveClass(
      "is-open",
    );
    expect(
      container.querySelector(".lp-waitlist-drawer-inner"),
    ).toHaveAttribute("inert");
  });

  it("expands the drawer in place instead of opening the modal", () => {
    const showModal = vi.fn();
    HTMLDialogElement.prototype.showModal = showModal;

    const { container } = render(<WaitlistInline />);
    const toggle = container.querySelector(".lp-waitlist-toggle")!;

    fireEvent.click(toggle);

    expect(toggle).toHaveTextContent("Not now");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelector(".lp-waitlist-drawer")).toHaveClass(
      "is-open",
    );

    const drawer = container.querySelector<HTMLElement>(
      ".lp-waitlist-drawer-inner",
    )!;
    expect(drawer).not.toHaveAttribute("inert");
    expect(within(drawer).getByLabelText("Email")).toBeInTheDocument();
    expect(showModal).not.toHaveBeenCalled();

    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent("Join the waitlist");
    expect(container.querySelector(".lp-waitlist-drawer")).not.toHaveClass(
      "is-open",
    );
  });

  it("keeps the ghost cursors off when a fine pointer is absent", () => {
    const { container } = render(<WaitlistInline />);
    expect(container.querySelector(".lp-ghost-crew")).not.toBeInTheDocument();
  });

  it("settles the drawer height without animating on first render", () => {
    const { container } = render(<WaitlistInline />);
    const drawer = container.querySelector<HTMLElement>(".lp-waitlist-drawer")!;
    expect(drawer.style.height).toBe("0px");
  });

  it("still lets the email form submit from the expanded drawer", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "request-1" }), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<WaitlistInline />);
    fireEvent.click(container.querySelector(".lp-waitlist-toggle")!);

    const drawer = container.querySelector<HTMLElement>(
      ".lp-waitlist-drawer-inner",
    )!;
    fireEvent.change(within(drawer).getByLabelText("Email"), {
      target: { value: "builder@example.com" },
    });
    fireEvent.click(
      within(drawer).getByRole("button", { name: "Join the waitlist" }),
    );

    await screen.findByText("You're on the list.");
    expect(fetchMock).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });
});
