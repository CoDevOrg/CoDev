import { describe, expect, it } from "vitest";

import { validateCursorAuthCache } from "./cursor-cli-auth";

describe("validateCursorAuthCache", () => {
  it("keeps an access token login and only returns its last four characters", () => {
    const auth = validateCursorAuthCache({
      accessToken: "cursor-access-token-value-0001",
      refreshToken: "cursor-refresh-token-value-0001",
    });
    expect(auth.lastFour).toBe("0001");
    expect(JSON.parse(auth.serialized)).toMatchObject({
      accessToken: "cursor-access-token-value-0001",
    });
  });

  it("accepts the snake_case field some CLI builds write", () => {
    expect(
      validateCursorAuthCache({
        access_token: "cursor-access-token-value-0002",
      }).lastFour,
    ).toBe("0002");
  });

  it("refuses a file with no access token", () => {
    expect(() => validateCursorAuthCache({ email: "a@b.test" })).toThrow(
      /access token/i,
    );
  });
});
