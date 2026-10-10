import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
  verify,
} from "node:crypto";

export const PREVIEW_COOKIE = "__Host-codev-preview";
export const PREVIEW_SESSION_TTL_MS = 5 * 60_000;
export const PREVIEW_SESSION_CAP_MS = 30 * 60_000;
const MAX_USED_TOKENS = 10_000;
const HOST_PATTERN =
  /^p([1-9]\d{0,4})-([0-9a-f]{20})-g([1-9]\d{0,9})\.[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

// Preview hosts are p<port>-<sha256(workspaceId)[0:20]>-g<generation>.<zone>.
// Canonical labels only, so the token audience and cookie host match exactly.
export function previewHostPort(host, identity) {
  const match = typeof host === "string" ? HOST_PATTERN.exec(host) : null;
  if (!match || Number(match[3]) !== identity.generation) return null;
  const hash = createHash("sha256").update(identity.workspaceId).digest("hex");
  const port = Number(match[1]);
  return match[2] === hash.slice(0, 20) && port <= 65_535 ? port : null;
}

function isAppOrigin(value) {
  if (typeof value !== "string" || value.length > 255) return false;
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    return (
      url.origin === value &&
      (url.protocol === "https:" || (url.protocol === "http:" && local))
    );
  } catch {
    return false;
  }
}

function claimsMatch(claims, expected, second) {
  return (
    claims.iss === "codev-control-plane" &&
    claims.aud === expected.host &&
    claims.scope === "preview" &&
    claims.workspaceId === expected.identity.workspaceId &&
    claims.generation === expected.identity.generation &&
    claims.port === expected.port &&
    typeof claims.sub === "string" &&
    claims.sub.length > 0 &&
    claims.sub.length <= 256 &&
    isAppOrigin(claims.appOrigin) &&
    typeof claims.jti === "string" &&
    /^[\w-]{16,128}$/.test(claims.jti) &&
    Number.isSafeInteger(claims.iat) &&
    Number.isSafeInteger(claims.exp) &&
    claims.iat <= second &&
    claims.exp > second &&
    claims.exp > claims.iat &&
    claims.exp - claims.iat <= 60
  );
}

// The control plane signs a single-use Ed25519 compact JWT for one preview
// host after its membership check; the VM holds only the verification key.
export function verifyPreviewToken(token, expected) {
  if (typeof token !== "string" || token.length > 8192) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((s) => !/^[\w-]+$/.test(s)))
      return null;
    const [header, claims] = parts
      .slice(0, 2)
      .map((part) =>
        JSON.parse(Buffer.from(part, "base64url").toString("utf8")),
      );
    const second = Math.floor(expected.now / 1000);
    if (header.alg !== "EdDSA" || header.typ !== "JWT") return null;
    if (!claimsMatch(claims, expected, second)) return null;
    const signed = verify(
      null,
      Buffer.from(`${parts[0]}.${parts[1]}`),
      expected.verifyKey,
      Buffer.from(parts[2], "base64url"),
    );
    if (!signed) return null;
    if (!expected.claimToken(claims.jti, claims.exp * 1000, expected.now))
      return null;
    return { sub: claims.sub, appOrigin: claims.appOrigin };
  } catch {
    return null;
  }
}

// Remembers used token ids until they expire. When every remembered token is
// still live the guard refuses new ones rather than forget a replayable id.
export function createTokenReplayGuard(limit = MAX_USED_TOKENS) {
  const used = new Map();
  return (jti, expiresAt, now) => {
    if (used.has(jti)) return false;
    for (const [id, expiry] of used) {
      if (expiry > now) break;
      used.delete(id);
    }
    if (used.size >= limit) return false;
    used.set(jti, expiresAt);
    return true;
  };
}

function previewCookieValues(header) {
  if (typeof header !== "string") return [];
  return header
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair.startsWith(`${PREVIEW_COOKIE}=`))
    .map((pair) => pair.slice(PREVIEW_COOKIE.length + 1));
}

function validSession(session) {
  return (
    typeof session?.host === "string" &&
    Number.isSafeInteger(session.port) &&
    typeof session.sub === "string" &&
    isAppOrigin(session.appOrigin) &&
    Number.isSafeInteger(session.exp) &&
    Number.isSafeInteger(session.cap) &&
    session.exp <= session.cap
  );
}

const sessionMac = (key, payload) =>
  createHmac("sha256", key).update(payload).digest();

function sessionCookie(key, session, now) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const value = `${payload}.${sessionMac(key, payload).toString("base64url")}`;
  const maxAge = Math.ceil((session.exp - now) / 1000);
  return `${PREVIEW_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=None; Partitioned`;
}

function decodeSession(key, value) {
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const actual = Buffer.from(signature, "base64url");
  const wanted = sessionMac(key, payload);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted))
    return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString());
    return validSession(session) ? session : null;
  } catch {
    return null;
  }
}

// Sessions are HMAC-SHA256 signed with a key that lives only in this process,
// so a proxy restart or a new VM generation ends every session.
export function createPreviewSessions(key = randomBytes(32)) {
  return {
    issue: ({ host, port, sub, appOrigin }, now) => {
      const exp = now + PREVIEW_SESSION_TTL_MS;
      const cap = now + PREVIEW_SESSION_CAP_MS;
      return sessionCookie(key, { host, port, sub, appOrigin, exp, cap }, now);
    },
    read: (header, host, port, now) =>
      previewCookieValues(header)
        .map((value) => decodeSession(key, value))
        .find(
          (session) =>
            session?.host === host &&
            session.port === port &&
            now < session.exp,
        ) ?? null,
    // Renew after half the TTL has elapsed, never past the session cap.
    renew: (session, now) => {
      if (session.exp - now > PREVIEW_SESSION_TTL_MS / 2) return null;
      const exp = Math.min(now + PREVIEW_SESSION_TTL_MS, session.cap);
      return exp > session.exp
        ? sessionCookie(key, { ...session, exp }, now)
        : null;
    },
  };
}
