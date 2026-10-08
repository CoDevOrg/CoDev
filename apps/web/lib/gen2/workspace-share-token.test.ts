import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { hashInviteToken } from "../platform/crypto";
import { workspaceShareToken } from "./workspace-share-token";
import { workspaceShareTokenHash } from "./workspace-share-token-hash";

beforeEach(() => vi.stubEnv("AUTH_SECRET", "group-sharing-test-secret"));
afterEach(() => vi.unstubAllEnvs());
it("reconstructs the same link without exposing an unsigned stored hash", () => {
  const hash = hashInviteToken("existing-random-invite");
  const token = workspaceShareToken(hash);
  expect(workspaceShareToken(hash)).toBe(token);
  expect(workspaceShareTokenHash(token)).toBe(hash);
  expect(workspaceShareTokenHash("existing-random-invite")).toBe(hash);
  expect(workspaceShareTokenHash(hash)).not.toBe(hash);
});
it("rejects modified hashes, signatures, and malformed signed links", () => {
  const hash = "a".repeat(64);
  const token = workspaceShareToken(hash);
  for (const forged of [
    token.replace(hash, "b".repeat(64)),
    `${token}x`,
    `${token}.extra`,
    "codev_invite.bad.bad",
  ]) {
    expect(() => workspaceShareTokenHash(forged)).toThrow("no longer valid");
  }
});
it("fails closed without a signing secret", () => {
  vi.stubEnv("AUTH_SECRET", "");
  expect(() => workspaceShareToken("a".repeat(64))).toThrow("AUTH_SECRET");
});
