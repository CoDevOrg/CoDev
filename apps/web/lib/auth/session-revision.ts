import { createHash } from "node:crypto";

/** Bind an encrypted session to the credential state without storing its hash. */
export function sessionRevision(passwordHash: string | null) {
  return createHash("sha256")
    .update(passwordHash ?? "oauth-only")
    .digest("hex");
}
