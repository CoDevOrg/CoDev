import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import LandingCanvas from "./landing-canvas";

const createLandingScene = vi.hoisted(() => vi.fn());

vi.mock("./landing-scene", () => ({ createLandingScene }));

function setMotionPreference(reduced: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: reduced && query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

function scene() {
  return {
    resize: vi.fn(),
    render: vi.fn(),
    setLite: vi.fn(),
    dispose: vi.fn(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  createLandingScene.mockReset();
});

describe("LandingCanvas", () => {
  it("never builds a scene when the reader asked for reduced motion", async () => {
    setMotionPreference(true);

    const { container } = render(<LandingCanvas />);

    await waitFor(() => {
      expect(container.querySelector(".lp-canvas-layer")).not.toBeNull();
    });
    expect(createLandingScene).not.toHaveBeenCalled();
    // `data-canvas="off"` is what keeps the server-rendered still on screen.
    expect(
      container.querySelector(".lp-canvas-layer")?.getAttribute("data-canvas"),
    ).toBe("off");
  });

  it("falls back silently when the scene cannot get a 2D context", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setMotionPreference(false);
    createLandingScene.mockReturnValue(null);

    const { container } = render(<LandingCanvas />);

    await waitFor(() => {
      expect(createLandingScene).toHaveBeenCalledTimes(1);
    });
    // The landing e2e suite fails the build on any console error, so the
    // fallback has to be completely quiet and keep the still on screen.
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(
      container.querySelector(".lp-canvas-layer")?.getAttribute("data-canvas"),
    ).toBe("off");
  });

  it("starts the scene when motion is allowed", async () => {
    setMotionPreference(false);
    const instance = scene();
    createLandingScene.mockReturnValue(instance);

    const { container } = render(<LandingCanvas />);

    await waitFor(() => {
      expect(createLandingScene).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(
        container
          .querySelector(".lp-canvas-layer")
          ?.getAttribute("data-canvas"),
      ).toBe("on");
    });
    expect(instance.resize).toHaveBeenCalled();
  });

  it("disposes the scene and drops its listeners on unmount", async () => {
    setMotionPreference(false);
    const instance = scene();
    createLandingScene.mockReturnValue(instance);
    const removeListener = vi.spyOn(window, "removeEventListener");

    const { unmount } = render(<LandingCanvas />);
    await waitFor(() => {
      expect(createLandingScene).toHaveBeenCalledTimes(1);
    });

    unmount();

    expect(instance.dispose).toHaveBeenCalledTimes(1);
    const removed = removeListener.mock.calls.map((call) => call[0]);
    expect(removed).toContain("scroll");
    expect(removed).toContain("resize");
    expect(removed).toContain("pointermove");
  });

  it("marks the whole layer decorative", async () => {
    setMotionPreference(false);
    createLandingScene.mockReturnValue(scene());

    const { container } = render(<LandingCanvas />);

    await waitFor(() => {
      expect(container.querySelector(".lp-canvas-layer")).not.toBeNull();
    });
    expect(
      container.querySelector(".lp-canvas-layer")?.getAttribute("aria-hidden"),
    ).toBe("true");
    // Nothing in the backdrop may be reachable by a screen reader.
    expect(screen.queryByRole("img")).toBeNull();
  });
});
