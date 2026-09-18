import { describe, expect, it } from "vitest";

import {
  getNewAccountPasswordError,
  getNewAccountPasswordRequirements,
  NEW_ACCOUNT_PASSWORD_MIN_LENGTH,
} from "./password-policy";

describe("new-account password policy", () => {
  it("requires a 10-character password with the standard character classes", () => {
    expect(getNewAccountPasswordError("Short1!")).toBe(
      `At least ${NEW_ACCOUNT_PASSWORD_MIN_LENGTH} characters`,
    );
    expect(getNewAccountPasswordError("longenough1!")).toBe(
      "One uppercase letter",
    );
    expect(getNewAccountPasswordError("Longenough!!")).toBe("One number");
    expect(getNewAccountPasswordError("Longenough1")).toBe(
      "One special character",
    );
    expect(getNewAccountPasswordError("StrongPass1!")).toBeNull();
  });

  it("returns a user-facing status for every requirement", () => {
    expect(getNewAccountPasswordRequirements("StrongPass1!")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "length", met: true }),
        expect.objectContaining({ id: "uppercase", met: true }),
        expect.objectContaining({ id: "lowercase", met: true }),
        expect.objectContaining({ id: "number", met: true }),
        expect.objectContaining({ id: "symbol", met: true }),
        expect.objectContaining({ id: "uncommon", met: true }),
      ]),
    );
  });

  it("rejects common passwords", () => {
    expect(getNewAccountPasswordRequirements("password123")).toContainEqual(
      expect.objectContaining({ id: "uncommon", met: false }),
    );
  });
});
