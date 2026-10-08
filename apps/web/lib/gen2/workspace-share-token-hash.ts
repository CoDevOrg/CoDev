import "server-only";
import { timingSafeEqual } from "node:crypto";
import { hashInviteToken } from "../platform/crypto";
import { workspaceShareToken } from "./workspace-share-token";
import { Gen2AccessError } from "./errors";

/** Existing opaque invitations remain valid alongside recoverable signed links. */
export function workspaceShareTokenHash(token: string) {
  if (!token.startsWith("codev_invite.")) return hashInviteToken(token);
  const [, hash, signature, extra] = token.split(".");
  if (!hash || !/^[a-f0-9]{64}$/.test(hash) || !signature || extra) {
    throw new Gen2AccessError("This invite link is no longer valid.", 404);
  }
  const actual = Buffer.from(token);
  const expected = Buffer.from(workspaceShareToken(hash));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Gen2AccessError("This invite link is no longer valid.", 404);
  }
  return hash;
}
