import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { REQUEST_ACCESS_EVENT } from "./request-access-button";
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

  it("shows the signup form directly, with no toggle button", () => {
    const { container } = render(<WaitlistInline />);

    expect(screen.getByLabelText("Email")).toBeVisible();
    // The only button is the form's own submit; nothing expands/collapses.
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute("type", "submit");
    expect(buttons[0]).not.toHaveAttribute("aria-expanded");
    expect(container.querySelector("[inert]")).not.toBeInTheDocument();
  });

  it("scrolls to the form and focuses email when a CTA fires", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    render(<WaitlistInline />);

    act(() => {
      window.dispatchEvent(new CustomEvent(REQUEST_ACCESS_EVENT));
    });

    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("keeps the ghost cursors off when a fine pointer is absent", () => {
    const { container } = render(<WaitlistInline />);
    expect(container.querySelector(".lp-ghost-crew")).not.toBeInTheDocument();
  });

  it("submits the email form", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "request-1" }), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<WaitlistInline />);
    const card = container.querySelector<HTMLElement>(".lp-waitlist-card")!;

    fireEvent.change(within(card).getByLabelText("Email"), {
      target: { value: "builder@example.com" },
    });
    fireEvent.click(
      within(card).getByRole("button", { name: "Join the waitlist" }),
    );

    await screen.findByText("You're on the list.");
    expect(fetchMock).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });
});
