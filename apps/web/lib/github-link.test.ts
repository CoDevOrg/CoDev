import { afterEach, describe, expect, it, vi } from "vitest";

import { createGithubLinkState, openGithubLinkState } from "./github-link";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("GitHub account linking state", () => {
  it("round-trips the authenticated user and safe return path", () => {
    vi.stubEnv("AUTH_SECRET", "a".repeat(40));

    const encoded = createGithubLinkState(
      "user-1",
      "/settings/personal/profile?github=connected",
    );

    expect(openGithubLinkState(encoded)).toMatchObject({
      userId: "user-1",
      returnTo: "/settings/personal/profile?github=connected",
    });
  });

  it("rejects tampered and expired state", () => {
    vi.stubEnv("AUTH_SECRET", "a".repeat(40));
    vi.useFakeTimers();

    const encoded = createGithubLinkState("user-1", "/dashboard");
    expect(openGithubLinkState(`${encoded}x`)).toBeNull();
    expect(openGithubLinkState(`${encoded}.extra`)).toBeNull();

    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    expect(openGithubLinkState(encoded)).toBeNull();
  });

  it("falls back to the dashboard for an unsafe return path", () => {
    vi.stubEnv("AUTH_SECRET", "a".repeat(40));

    const encoded = createGithubLinkState("user-1", "https://evil.example");

    expect(openGithubLinkState(encoded)).toMatchObject({
      userId: "user-1",
      returnTo: "/dashboard",
    });
  });
});
