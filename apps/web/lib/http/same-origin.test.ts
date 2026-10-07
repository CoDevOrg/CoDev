import { describe, expect, it } from "vitest";
import { hasSameOrigin } from "./same-origin";

describe("browser socket origin", () => {
  it.each([
    undefined,
    "null",
    "not-a-url",
    "https://evil.example",
    "https://guest.trycodev.com",
    "http://trycodev.com",
    "https://trycodev.com:444",
    "https://trycodev.com/path",
  ])("rejects %s", (origin) => {
    expect(
      hasSameOrigin(
        new Request("https://trycodev.com/api/socket", {
          headers: origin ? { origin } : {},
        }),
      ),
    ).toBe(false);
  });
  it.each([
    "https://trycodev.com",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
  ])("allows the exact origin %s", (origin) => {
    expect(
      hasSameOrigin(
        new Request(`${origin}/api/socket`, { headers: { origin } }),
      ),
    ).toBe(true);
  });
});
