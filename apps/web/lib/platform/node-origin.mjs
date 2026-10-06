import { timingSafeEqual } from "node:crypto";

const hosts = new Set([
  "trycodev.com",
  "www.trycodev.com",
  "admins.trycodev.com",
]);
const loopbacks = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** Queue handlers are process-private even when a request passes the edge gate. */
export function prepareNodeRequest(request, secret) {
  let path;
  try {
    path = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
  } catch {
    return false;
  }
  const workflow = path.startsWith("/.well-known/workflow/");
  const internal = workflow && loopbacks.has(request.socket.remoteAddress);
  if (workflow && !internal) return false;
  if (!internal) {
    const received = Buffer.from(
      request.headers["x-codev-origin-secret"] || "",
    );
    const expected = Buffer.from(secret);
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    )
      return false;
  }
  const host = internal
    ? "www.trycodev.com"
    : request.headers["x-codev-public-host"];
  if (!hosts.has(host)) return false;
  request.headers.host = host;
  request.headers["x-forwarded-host"] = host;
  request.headers["x-forwarded-proto"] = "https";
  const id = request.headers["x-codev-node-websocket-id"];
  if (!globalThis.__codevNodeWebSocketUpgrades?.has(id))
    delete request.headers["x-codev-node-websocket-id"];
  return true;
}
