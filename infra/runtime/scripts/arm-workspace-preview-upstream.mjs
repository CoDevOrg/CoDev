import { readFile } from "node:fs/promises";
import { PREVIEW_COOKIE } from "./arm-workspace-preview-token.mjs";

// Guest services, the dummy Superset API port and cloudflared's metrics range.
const RESERVED_PREVIEW_PORTS = new Set([
  9, 4879, 5252, 5260, 5261, 20241, 20242, 20243, 20244, 20245,
]);
// Terminals run as codev-shell (2000) and agents above it. Root, the image
// builder (1000) and system accounts must never be reachable.
const MEMBER_UID = 2000;
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "http2-settings",
]);

function ipv4(hex) {
  return [6, 4, 2, 0]
    .map((at) => parseInt(hex.slice(at, at + 2), 16))
    .join(".");
}

// tcp6 prints four 32-bit words in host (little-endian) byte order.
function ipv6(hex) {
  const bytes = hex
    .toLowerCase()
    .match(/.{8}/g)
    .flatMap((word) => word.match(/../g).reverse());
  if (
    bytes.slice(0, 10).every((b) => b === "00") &&
    bytes[10] + bytes[11] === "ffff"
  )
    return ipv4(bytes.slice(12).reverse().join(""));
  const groups = bytes
    .join("")
    .match(/.{4}/g)
    .map((g) => parseInt(g, 16));
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] <= 1)
    return groups[7] ? "::1" : "::";
  return groups.map((g) => g.toString(16)).join(":");
}

function parseListeningSockets(text, family) {
  return text
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields[3] === "0A")
    .flatMap(([, local, , , , , , uid]) => {
      const match = /^([0-9A-F]{8}|[0-9A-F]{32}):([0-9A-F]{4})$/i.exec(local);
      if (!match || !/^\d+$/.test(uid ?? "")) return [];
      const address = family === 4 ? ipv4(match[1]) : ipv6(match[1]);
      return [{ address, port: parseInt(match[2], 16), uid: Number(uid) }];
    });
}

export async function listListeningPorts(
  read = (path) => readFile(path, "utf8"),
) {
  const tables = await Promise.all(
    [
      ["/proc/net/tcp", 4],
      ["/proc/net/tcp6", 6],
    ].map(async ([path, family]) => {
      try {
        return parseListeningSockets(await read(path), family);
      } catch (error) {
        // A kernel booted without IPv6 has no tcp6 table.
        if (family === 6 && error?.code === "ENOENT") return [];
        throw error;
      }
    }),
  );
  return tables.flat();
}

// Connect only to the loopback address of a member-owned LISTEN row, so the
// ownership check and the connection always describe the same socket.
export function previewUpstream(sockets, port) {
  if (RESERVED_PREVIEW_PORTS.has(port)) return { error: "forbidden" };
  const rows = sockets.filter((row) => row.port === port);
  if (rows.some((row) => !(row.uid >= MEMBER_UID)))
    return { error: "forbidden" };
  const loopback = rows.map(({ address }) =>
    address === "127.0.0.1" || address === "0.0.0.0"
      ? "127.0.0.1"
      : address === "::1" || address === "::"
        ? "::1"
        : null,
  );
  if (loopback.includes("127.0.0.1")) return { host: "127.0.0.1" };
  if (loopback.includes("::1")) return { host: "::1" };
  return { error: "not_listening" };
}

function pairs(rawHeaders) {
  const result = [];
  for (let at = 0; at < rawHeaders.length; at += 2)
    result.push([rawHeaders[at].toLowerCase(), rawHeaders[at + 1]]);
  return result;
}

function connectionTokens(headers) {
  return new Set(
    headers
      .filter(([name]) => name === "connection")
      .flatMap(([, value]) => value.split(","))
      .map((token) => token.trim().toLowerCase()),
  );
}

function rewriteRequestHeader(name, value, { host, port }) {
  const local = `http://localhost:${port}`;
  if (name === "origin") return local;
  if (name === "referer") {
    try {
      const url = new URL(value);
      if (url.origin !== `https://${host}`) return null;
      return `${local}${url.pathname}${url.search}`;
    } catch {
      return null;
    }
  }
  if (name === "cookie") {
    const kept = value
      .split(";")
      .map((pair) => pair.trim())
      .filter((pair) => pair && !pair.startsWith(`${PREVIEW_COOKIE}=`));
    return kept.length ? kept.join("; ") : null;
  }
  return value;
}

// Origin was already checked against https://<preview host>; only then does the
// request look like it came from localhost, as dev servers expect.
export function upstreamRequestHeaders(rawHeaders, target) {
  const headers = pairs(rawHeaders);
  const dropped = connectionTokens(headers);
  const result = ["Host", `localhost:${target.port}`];
  for (const [name, value] of headers) {
    if (
      name === "host" ||
      name === "expect" ||
      name === "forwarded" ||
      name === "x-real-ip" ||
      name.startsWith("x-forwarded-") ||
      ((HOP_BY_HOP.has(name) || dropped.has(name)) &&
        !(target.upgrade && name === "upgrade"))
    )
      continue;
    const rewritten = rewriteRequestHeader(name, value, target);
    if (rewritten !== null) result.push(name, rewritten);
  }
  if (target.upgrade) result.push("Connection", "Upgrade");
  // Node frames GET, DELETE and OPTIONS bodies only when told to; unframed
  // bytes would reach the dev server as a second, unrewritten request.
  else if (headers.some(([name]) => name === "transfer-encoding"))
    result.push("Transfer-Encoding", "chunked");
  return result;
}

function withoutFrameAncestors(value) {
  return value
    .split(",")
    .map((policy) =>
      policy
        .split(";")
        .filter(
          (rule) =>
            rule.trim().split(/\s+/)[0].toLowerCase() !== "frame-ancestors",
        )
        .join(";")
        .trim(),
    )
    .filter((policy) => policy.replaceAll(";", "").trim())
    .join(", ");
}

// Shared caches must never keep a member's preview: Cloudflare's cache key
// ignores the session cookie.
function privateCacheControl(values) {
  const kept = values
    .flatMap((value) => value.split(","))
    .map((directive) => directive.trim())
    .filter(
      (directive) =>
        directive &&
        !/^(?:public|private|proxy-revalidate|s-maxage=.*)$/i.test(directive),
    );
  return ["private", ...kept].join(", ");
}

function rewriteResponseHeader(name, value, port) {
  if (
    name === "content-security-policy" ||
    name === "content-security-policy-report-only"
  )
    return withoutFrameAncestors(value) || null;
  if (name === "set-cookie")
    return value.trimStart().startsWith(`${PREVIEW_COOKIE}=`) ? null : value;
  if (name !== "location") return value;
  const local = new RegExp(
    `^https?://(?:localhost|127\\.0\\.0\\.1|\\[::1\\]):${port}(?=[/?#]|$)`,
    "i",
  );
  if (!local.test(value)) return value;
  const path = value.replace(local, "");
  // `//host` or `/\host` would become a protocol-relative redirect elsewhere.
  if (/^[/\\]{2}/.test(path)) return value;
  return path.startsWith("/") ? path : `/${path}`;
}

export function downstreamResponseHeaders(rawHeaders, { port, appOrigin }) {
  const headers = pairs(rawHeaders);
  const dropped = connectionTokens(headers);
  const result = [];
  for (const [name, value] of headers) {
    if (
      HOP_BY_HOP.has(name) ||
      dropped.has(name) ||
      /^(?:x-frame-options|cache-control|cdn-cache-control|cloudflare-cdn-cache-control|surrogate-control)$/.test(
        name,
      )
    )
      continue;
    const rewritten = rewriteResponseHeader(name, value, port);
    if (rewritten !== null) result.push(name, rewritten);
  }
  const cacheControl = headers.filter(([name]) => name === "cache-control");
  result.push(
    "Cache-Control",
    privateCacheControl(cacheControl.map(([, value]) => value)),
    "Cloudflare-CDN-Cache-Control",
    "no-store",
    "Content-Security-Policy",
    `frame-ancestors ${appOrigin}`,
  );
  return result;
}
