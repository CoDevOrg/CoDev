import { randomBytes } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { pipeline } from "node:stream";
import {
  createPreviewSessions,
  createTokenReplayGuard,
  previewHostPort,
  verifyPreviewToken,
} from "./arm-workspace-preview-token.mjs";
import { proxyPreviewUpgrade } from "./arm-workspace-preview-upgrade.mjs";
import {
  downstreamResponseHeaders,
  previewUpstream,
  upstreamRequestHeaders,
} from "./arm-workspace-preview-upstream.mjs";

const CONTROL_PREFIX = "/__codev/preview/";
const SESSION_PATH = `${CONTROL_PREFIX}session`;
const CHECK_PATH = `${CONTROL_PREFIX}check`;
const MAX_SOCKETS = 256;
const NO_STORE = {
  "Cache-Control": "no-store",
  "Cloudflare-CDN-Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

function reply(response, status, message, headers = {}) {
  response.writeHead(status, {
    ...NO_STORE,
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(message);
}

function redirect(response, location, headers = {}) {
  response.writeHead(303, { ...NO_STORE, Location: location, ...headers });
  response.end();
}

// Resolve `next` on this preview origin and emit only its path, query and hash,
// so neither `/\evil.example` nor `/.//evil.example` can leave the host.
export function previewNextPath(next, host) {
  if (typeof next !== "string" || next.length > 2048) return "/";
  try {
    const url = new URL(next, `https://${host}`);
    if (
      url.origin !== `https://${host}` ||
      url.pathname.startsWith("//") ||
      url.pathname.startsWith(CONTROL_PREFIX)
    )
      return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

// Safari and hardened browsers drop cookies in cross-site frames; say so on
// the preview's own origin instead of failing with the generic 401.
function blockedCookiePage(response) {
  const nonce = randomBytes(16).toString("base64");
  response.writeHead(200, {
    ...NO_STORE,
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors https:`,
  });
  response.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Preview blocked</title>
<style nonce="${nonce}">body{margin:24px;font:14px/1.5 system-ui,sans-serif;color:#1f2328;background:#fff}h1{margin:0 0 8px;font-size:16px}p{margin:0 0 12px}@media (prefers-color-scheme:dark){body{color:#e6edf3;background:#0d1117}}</style>
</head><body><h1>Your browser blocked this preview</h1>
<p>The preview needs a cookie, and this browser blocks cookies in embedded pages. Use Open in new tab in the CoDev browser toolbar, or allow cookies for this preview and then reload it in CoDev.</p>
<p><button id="allow" type="button" hidden>Allow preview cookies</button></p><p id="status" role="status"></p>
<script nonce="${nonce}">
const allow = document.getElementById("allow");
const status = document.getElementById("status");
if (document.requestStorageAccess) {
  allow.hidden = false;
  allow.addEventListener("click", () => document.requestStorageAccess().then(
    () => { status.textContent = "Cookies allowed. Reload the preview in CoDev."; },
    () => { status.textContent = "Your browser did not allow it. Use Open in new tab instead."; },
  ));
}
</script></body></html>`);
}

function control(request, response, context, host, port) {
  if (request.method !== "GET")
    return reply(response, 405, "Method not allowed.", { Allow: "GET" });
  const url = new URL(request.url, `https://${host}`);
  const next = previewNextPath(url.searchParams.get("next"), host);
  const now = context.now();
  if (url.pathname === CHECK_PATH)
    return context.sessions.read(request.headers.cookie, host, port, now)
      ? redirect(response, next)
      : blockedCookiePage(response);
  if (url.pathname !== SESSION_PATH) return reply(response, 404, "Not found.");
  const claims = verifyPreviewToken(url.searchParams.get("token"), {
    ...context,
    host,
    port,
    now,
  });
  if (!claims)
    return reply(
      response,
      401,
      "This preview link expired. Open it again from CoDev.",
    );
  const cookie = context.sessions.issue({ host, port, ...claims }, now);
  return redirect(response, `${CHECK_PATH}?next=${encodeURIComponent(next)}`, {
    "Set-Cookie": cookie,
  });
}

// Runs before any rewrite: every preview in the zone is same-site with every
// other, so only this exact origin may send credentialed non-navigations.
function crossSiteReason(request, host, upgrade) {
  const origin = request.headers.origin;
  const expected = `https://${host}`;
  if (origin !== undefined && origin !== expected)
    return "Cross-origin requests can't reach this preview.";
  if (
    (upgrade || !["GET", "HEAD"].includes(request.method)) &&
    origin !== expected
  )
    return "This request needs the preview's own Origin header.";
  const site = request.headers["sec-fetch-site"];
  if (
    site !== undefined &&
    site !== "same-origin" &&
    site !== "none" &&
    request.headers["sec-fetch-mode"] !== "navigate"
  )
    return "Cross-site requests can't reach this preview.";
  return null;
}

async function admit(request, context, upgrade) {
  const host = request.headers.host;
  const port = previewHostPort(host, context.identity);
  if (!port || !request.url.startsWith("/"))
    return { status: 421, message: "Unknown preview address." };
  const now = context.now();
  const session = context.sessions.read(
    request.headers.cookie,
    host,
    port,
    now,
  );
  if (!session)
    return { status: 401, message: "Open this preview from CoDev." };
  const denied = crossSiteReason(request, host, upgrade);
  if (denied) return { status: 403, message: denied };
  const upstream = previewUpstream(await context.listListeningPorts(), port);
  if (upstream.error === "forbidden")
    return { status: 403, message: `Port ${port} can't be previewed.` };
  if (upstream.error)
    return { status: 502, message: `Nothing is listening on port ${port}.` };
  const renewal = context.sessions.renew(session, now);
  return { host, port, session, address: upstream.host, renewal };
}

function forward(request, response, target) {
  const upstream = httpRequest({
    host: target.address,
    port: target.port,
    method: request.method,
    path: request.url,
    headers: upstreamRequestHeaders(request.rawHeaders, target),
    setHost: false,
    agent: false,
  });
  upstream.on("response", (answer) => {
    const headers = downstreamResponseHeaders(answer.rawHeaders, {
      port: target.port,
      appOrigin: target.session.appOrigin,
    });
    if (target.renewal) headers.push("Set-Cookie", target.renewal);
    response.writeHead(answer.statusCode, headers);
    pipeline(answer, response, () => {});
  });
  upstream.on("error", () => {
    if (response.headersSent) return response.destroy();
    reply(response, 502, `Nothing is answering on port ${target.port}.`);
  });
  response.on("close", () => {
    if (!response.writableFinished) upstream.destroy();
  });
  request.pipe(upstream);
}

async function handle(request, response, context) {
  const host = request.headers.host;
  const port = previewHostPort(host, context.identity);
  if (port && request.url.startsWith(CONTROL_PREFIX))
    return control(request, response, context, host, port);
  const target = await admit(request, context, false);
  if (target.status) return reply(response, target.status, target.message);
  forward(request, response, target);
}

export function createWorkspacePreviewProxy({
  identity,
  verifyKey,
  listListeningPorts,
  now = Date.now,
}) {
  if (verifyKey?.asymmetricKeyType !== "ed25519")
    throw new Error("Ed25519 verification key required");
  const context = {
    identity,
    verifyKey,
    listListeningPorts,
    now,
    sessions: createPreviewSessions(),
    claimToken: createTokenReplayGuard(),
  };
  const server = createServer((request, response) => {
    handle(request, response, context).catch(() => {
      // Never return upstream exceptions, headers, cookies or tokens.
      if (response.headersSent) return response.destroy();
      reply(response, 503, "Preview is unavailable.");
    });
  });
  server.on("upgrade", (request, socket, head) => {
    const admitUpgrade = () => admit(request, context, true);
    proxyPreviewUpgrade(request, socket, head, admitUpgrade).catch(() =>
      socket.destroy(),
    );
  });
  server.maxConnections = MAX_SOCKETS;
  server.headersTimeout = 30_000;
  server.maxHeadersCount = 128;
  // Outlive cloudflared's 90 s idle origin connections so it never reuses a
  // socket this server has just closed.
  server.keepAliveTimeout = 95_000;
  return server;
}
