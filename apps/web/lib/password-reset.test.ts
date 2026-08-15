import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPasswordResetToken,
  getPublicAppOrigin,
  openPasswordResetToken,
  passwordResetFingerprint,
  passwordResetTokenStillValid,
  shouldSendPasswordReset,
} from "./password-reset";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("password reset tokens", () => {
  it("round-trips a signed reset token", () => {
    vi.stubEnv("AUTH_SECRET", "a".repeat(40));

    const token = createPasswordResetToken({
      userId: "user-1",
      email: "Ada@Example.com",
      passwordHash: "salt.hash",
    });
    const opened = openPasswordResetToken(token);

    expect(opened).toMatchObject({
      userId: "user-1",
      email: "ada@example.com",
      fingerprint: passwordResetFingerprint("salt.hash"),
    });
  });

  it("rejects tampered and expired tokens", () => {
    vi.stubEnv("AUTH_SECRET", "a".repeat(40));
    vi.useFakeTimers();

    const token = createPasswordResetToken({
      userId: "user-1",
      email: "ada@example.com",
      passwordHash: "salt.hash",
    });
    expect(openPasswordResetToken(`${token}x`)).toBeNull();
    expect(openPasswordResetToken(`${token}.extra`)).toBeNull();

    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    expect(openPasswordResetToken(token)).toBeNull();
  });

  it("invalidates a token after the password hash changes", () => {
    vi.stubEnv("AUTH_SECRET", "a".repeat(40));
    const token = createPasswordResetToken({
      userId: "user-1",
      email: "ada@example.com",
      passwordHash: "old-hash",
    });
    const state = openPasswordResetToken(token);
    expect(state).not.toBeNull();
    expect(
      passwordResetTokenStillValid(state!, {
        id: "user-1",
        email: "ada@example.com",
        passwordHash: "new-hash",
      }),
    ).toBe(false);
    expect(
      passwordResetTokenStillValid(state!, {
        id: "user-1",
        email: "ada@example.com",
        passwordHash: "old-hash",
      }),
    ).toBe(true);
  });

  it("only emails accounts that already have a local password", () => {
    expect(
      shouldSendPasswordReset({
        email: "ada@example.com",
        passwordHash: "salt.hash",
      }),
    ).toBe(true);
    expect(
      shouldSendPasswordReset({
        email: "ada@example.com",
        passwordHash: null,
      }),
    ).toBe(false);
    expect(shouldSendPasswordReset(null)).toBe(false);
  });

  it("prefers AUTH_URL for reset links", () => {
    expect(
      getPublicAppOrigin({
        AUTH_URL: "https://trycodev.com/",
        VERCEL_URL: "codev-preview.vercel.app",
      }),
    ).toBe("https://trycodev.com");
  });
});
