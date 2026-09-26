import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom implements neither of these, and a component that scrolls a thread
// into view or measures a resizable pane is doing something ordinary. Stub
// them once rather than in every suite that renders one.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Nor IntersectionObserver, which the landing surfaces use to reveal sections
// and to park animation loops while they are off screen.
if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class {
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds: ReadonlyArray<number> = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}

// jsdom has no matchMedia, and several components branch on
// `prefers-reduced-motion` before they do anything else. Default to "motion is
// fine" so existing suites are unaffected; a test that cares stubs the return.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
});
