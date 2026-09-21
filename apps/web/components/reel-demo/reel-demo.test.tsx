import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReelDemo } from "./reel-demo";
import {
  adjacentScene,
  REEL_DURATION_MS,
  REEL_SCENES,
  sceneForElapsed,
  stableTimeForScene,
  typedPrefix,
} from "./timeline";

function mockReducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("reel timeline", () => {
  it("selects every scene at its exact boundary", () => {
    for (const scene of REEL_SCENES) {
      expect(sceneForElapsed(scene.start).name).toBe(scene.name);
    }
    expect(sceneForElapsed(REEL_DURATION_MS).name).toBe("review");
    expect(sceneForElapsed(-1).name).toBe("open");
  });

  it("provides stable recording frames and bounded adjacent navigation", () => {
    expect(stableTimeForScene("conflict")).toBe(21_500);
    expect(adjacentScene("open", -1).name).toBe("open");
    expect(adjacentScene("open", 1).name).toBe("share");
    expect(adjacentScene("review", 1).name).toBe("review");
  });

  it("reveals agent edits deterministically at typing boundaries", () => {
    expect(typedPrefix("typing", 1_000, 1_000, 2_000)).toBe("");
    expect(typedPrefix("typing", 1_500, 1_000, 2_000)).toBe("typ");
    expect(typedPrefix("typing", 2_000, 1_000, 2_000)).toBe("typing");
  });
});

describe("ReelDemo", () => {
  beforeEach(() => {
    mockReducedMotion(false);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  it("renders deterministic scene controls without touching production services", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const clipboardSpy = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardSpy },
    });

    render(
      <ReelDemo
        initialAutoplay={false}
        initialControls
        initialLoop
        initialScene="share"
      />,
    );

    expect(screen.getByLabelText("Share workspace dialog")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Demo scene" })).toHaveValue(
      "share",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(clipboardSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("supports keyboard playback, scene navigation, replay, and scrubbing", () => {
    render(
      <ReelDemo
        initialAutoplay={false}
        initialControls
        initialLoop
        initialScene="open"
      />,
    );

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("combobox", { name: "Demo scene" })).toHaveValue(
      "share",
    );

    fireEvent.keyDown(window, { code: "Space" });
    expect(screen.getByRole("button", { name: "Pause reel" })).toBeVisible();

    const scrubber = screen.getByRole("slider", {
      name: "Scrub reel timeline",
    });
    fireEvent.change(scrubber, { target: { value: "13500" } });
    expect(screen.getByRole("button", { name: "Play reel" })).toBeVisible();
    expect(screen.getByText("13.5s / 28.0s")).toBeVisible();

    fireEvent.keyDown(scrubber, { code: "Space" });
    expect(screen.getByRole("button", { name: "Pause reel" })).toBeVisible();

    fireEvent.keyDown(window, { key: "r" });
    expect(screen.getByText("0.0s / 28.0s")).toBeVisible();
  });

  it("stays paused on a stable frame when reduced motion is requested", async () => {
    mockReducedMotion(true);
    render(
      <ReelDemo
        initialAutoplay
        initialControls
        initialLoop
        initialScene="agents"
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Play reel" })).toBeVisible(),
    );
    expect(screen.getByRole("combobox", { name: "Demo scene" })).toHaveValue(
      "agents",
    );
  });
});
