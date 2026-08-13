import { describe, expect, it } from "vitest";

import {
  getNewAccountPasswordError,
  NEW_ACCOUNT_PASSWORD_MIN_LENGTH,
} from "./password-policy";

describe("new-account password policy", () => {
  it("requires a 15-character passphrase for a new account", () => {
    expect(getNewAccountPasswordError("fourteen chars")).toBe(
      `Use at least ${NEW_ACCOUNT_PASSWORD_MIN_LENGTH} characters for a new account.`,
    );
    expect(getNewAccountPasswordError("fifteen chars!!")).toBeNull();
  });

  it("rejects common passwords even when they are long enough", () => {
    expect(getNewAccountPasswordError("PASSWORD123")).toBe(
      "Choose a less common password or passphrase.",
    );
  });
});
