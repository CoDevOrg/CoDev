import { createHash, verify } from "node:crypto";

// An Ed25519 compact JWT also binds the exact method, raw path and body. The
// control plane signs only after membership checks; the VM holds no signing key.
export function authorizeCapability(
  token,
  request,
  identity,
  now = Date.now(),
) {
  if (typeof token !== "string" || token.length > 8192) return false;
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((s) => !/^[\w-]+$/.test(s)))
      return false;
    const [header, claims] = parts
      .slice(0, 2)
      .map((part) =>
        JSON.parse(Buffer.from(part, "base64url").toString("utf8")),
      );
    const second = Math.floor(now / 1000);
    const digest = createHash("sha256").update(request.body).digest("hex");
    if (
      header.alg !== "EdDSA" ||
      header.typ !== "JWT" ||
      claims.iss !== "codev-control-plane" ||
      claims.aud !== identity.audience ||
      claims.workspaceId !== identity.workspaceId ||
      claims.generation !== identity.generation ||
      claims.method !== request.method ||
      claims.path !== request.path ||
      claims.bodySha256 !== digest ||
      claims.scope !== request.scope ||
      !Number.isSafeInteger(claims.iat) ||
      !Number.isSafeInteger(claims.exp) ||
      claims.iat > second ||
      claims.exp <= second ||
      claims.exp <= claims.iat ||
      claims.exp - claims.iat > 60
    )
      return false;
    return verify(
      null,
      Buffer.from(`${parts[0]}.${parts[1]}`),
      identity.verificationKey,
      Buffer.from(parts[2], "base64url"),
    );
  } catch {
    return false;
  }
}
