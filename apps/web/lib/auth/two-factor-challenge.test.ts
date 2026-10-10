import { describe, expect, it, vi } from "vitest";

vi.mock("../platform/database", () => ({ getDatabase: vi.fn() }));
import {
  safeCallbackPath,
  twoFactorChallengePath,
} from "./two-factor-challenge";

describe("two-factor challenge paths", () => {
  it("keeps same-site paths and refuses open redirects", () => {
    expect(safeCallbackPath("/settings/personal/security")).toBe(
      "/settings/personal/security",
    );
    expect(safeCallbackPath("//evil.example")).toBe("/gen2");
    expect(safeCallbackPath("/\\evil.example")).toBe("/gen2");
    expect(safeCallbackPath("/\t/evil.example")).toBe("/gen2");
    expect(safeCallbackPath("/%09/evil.example")).toBe("/%09/evil.example");
    expect(safeCallbackPath("/gen2?tab=chat#x")).toBe("/gen2?tab=chat#x");
    expect(safeCallbackPath("https://evil.example")).toBe("/gen2");
    expect(safeCallbackPath(undefined)).toBe("/gen2");
  });

  it("carries the destination through the code step", () => {
    expect(twoFactorChallengePath("/gen2/w/1?tab=chat")).toBe(
      "/sign-in/two-factor?callbackUrl=%2Fgen2%2Fw%2F1%3Ftab%3Dchat",
    );
  });
});
