import { describe, expect, it } from "vitest";
import {
  analyticsAllowed,
  analyticsPath,
  analyticsReferrer,
} from "./privacy-preferences";

describe("privacy preferences", () => {
  it("requires affirmative consent and respects privacy signals", () => {
    expect(analyticsAllowed("")).toBe(false);
    expect(analyticsAllowed("codev_analytics=denied")).toBe(false);
    expect(analyticsAllowed("other_codev_analytics=allowed")).toBe(false);
    expect(analyticsAllowed("session=x; codev_analytics=allowed")).toBe(true);
    expect(analyticsAllowed("codev_analytics=allowed", true)).toBe(false);
  });
  it("removes query secrets, fragments and resource IDs", () => {
    expect(analyticsPath("/sign-in?token=secret#credential")).toBe("/sign-in");
    expect(
      analyticsPath(
        "https://trycodev.com/gen2/11111111-1111-4111-8111-111111111111?x=secret",
      ),
    ).toBe("/gen2/:id");
    expect(
      analyticsReferrer("https://example.com/private?token=secret#key"),
    ).toBe("https://example.com");
    expect(analyticsReferrer("bad URL")).toBeNull();
  });
});
