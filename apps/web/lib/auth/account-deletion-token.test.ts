import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAccountDeletionToken,
  verifyAccountDeletionToken,
} from "./account-deletion-token";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe("deletion verification", () => {
  it("binds confirmation to account, email, signature and expiry", () => {
    vi.stubEnv("AUTH_SECRET", "test-only-deletion-secret");
    vi.useFakeTimers();
    const token = createAccountDeletionToken("a", "a@example.test");
    expect(verifyAccountDeletionToken(token, "a", "a@example.test")).toBe(true);
    expect(verifyAccountDeletionToken(token, "b", "a@example.test")).toBe(
      false,
    );
    expect(verifyAccountDeletionToken(token, "a", "b@example.test")).toBe(
      false,
    );
    expect(verifyAccountDeletionToken(token + "x", "a", "a@example.test")).toBe(
      false,
    );
    expect(verifyAccountDeletionToken("invalid", "a", "a@example.test")).toBe(
      false,
    );
    vi.advanceTimersByTime(15 * 60_000);
    expect(verifyAccountDeletionToken(token, "a", "a@example.test")).toBe(
      false,
    );
  });
});
