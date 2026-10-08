import "server-only";
import { createHmac } from "node:crypto";

/** Recoverable invitation capability without persisting its bearer URL. */
export function workspaceShareToken(tokenHash: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret)
    throw new Error("AUTH_SECRET is required for workspace invitations.");
  const signature = createHmac("sha256", secret)
    .update(`codev:workspace-invite:${tokenHash}`)
    .digest("base64url");
  return `codev_invite.${tokenHash}.${signature}`;
}
