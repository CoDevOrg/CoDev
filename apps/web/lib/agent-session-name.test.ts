import { describe, expect, it } from "vitest";

import { deriveAgentSessionName } from "./agent-session-name";

describe("deriveAgentSessionName", () => {
  it("falls back when the prompt is empty or whitespace", () => {
    expect(deriveAgentSessionName("")).toBe("Agent");
    expect(deriveAgentSessionName("   \n\t  ")).toBe("Agent");
    expect(deriveAgentSessionName("", "Chat")).toBe("Chat");
  });

  it("uses the first prompt words as the session name", () => {
    expect(deriveAgentSessionName("Build a landing page")).toBe(
      "Build a landing page",
    );
  });

  it("collapses whitespace and trims", () => {
    expect(deriveAgentSessionName("  Add   dark   mode  ")).toBe(
      "Add dark mode",
    );
  });

  it("caps length at 32 characters on a word boundary when possible", () => {
    const name = deriveAgentSessionName(
      "Create a beautiful marketing site with hero and pricing",
    );
    expect(name.length).toBeLessThanOrEqual(32);
    expect(name).toBe("Create a beautiful marketing");
  });

  it("hard-cuts when there is no good word boundary", () => {
    const name = deriveAgentSessionName("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(name).toBe("abcdefghijklmnopqrstuvwxyz012345");
    expect(name.length).toBe(32);
  });

  it("falls back when sanitization removes everything", () => {
    expect(deriveAgentSessionName("@@@ ###")).toBe("Agent");
  });
});
