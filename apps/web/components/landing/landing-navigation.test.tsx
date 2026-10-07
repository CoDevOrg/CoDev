import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LandingNavigation } from "./landing-navigation";

afterEach(() => vi.restoreAllMocks());

it("contracts on scroll and expands when returning to the top", () => {
  const scroll = vi.spyOn(window, "scrollY", "get").mockReturnValue(0);
  render(<LandingNavigation />);
  const navigation = screen.getByRole("banner");
  expect(navigation).toHaveAttribute("data-compact", "false");

  scroll.mockReturnValue(120);
  fireEvent.scroll(window);
  expect(navigation).toHaveAttribute("data-compact", "true");

  scroll.mockReturnValue(0);
  fireEvent.scroll(window);
  expect(navigation).toHaveAttribute("data-compact", "false");
});
