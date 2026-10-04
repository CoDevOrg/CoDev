import { createServer } from "node:http";
import { workspaceBootstrap } from "./arm-workspace-bootstrap.mjs";
import { authorizeCapability } from "./arm-workspace-capability.mjs";

const limit = 2 << 20;

function scopeFor(method, path) {
  const pathname = path.split("?")[0];
  if (
    /[%#\\]/.test(pathname) ||
    new URL(path, "http://localhost").pathname !== pathname
  )
    return null;
  if (method === "GET" && path === "/v1/health") return "health";
  if (method === "POST" && path === "/v1/workspace/initialize")
    return "workspace";
  if (method === "GET" && path === "/v1/runtime-activity") return "workspace";
  if (method === "POST" && path === "/v1/pty/exec") return "workspace";
  if (/^\/v1\/(?:files|superset|git)\//.test(path)) return "workspace";
  if (/^\/v1\/(?:terminals|codex-execs|superset-agents)(?:\/|$)/.test(path))
    return "workspace";
  return null;
}

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function reply(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function forward(request, body, guestUrl) {
  return fetch(`${guestUrl}${request.url}`, {
    method: request.method,
    headers: { "content-type": "application/json" },
    body: ["GET", "HEAD"].includes(request.method) ? undefined : body,
    signal: AbortSignal.timeout(65_000),
    redirect: "error",
  });
}

async function handle(
  request,
  response,
  identity,
  guestUrl,
  readiness,
  initialize,
) {
  const scope = scopeFor(request.method, request.url);
  if (!scope || !["GET", "POST", "DELETE"].includes(request.method))
    return reply(response, 404, { error: "NOT_FOUND" });
  if (
    typeof request.headers.authorization !== "string" ||
    !request.headers.authorization.startsWith("Bearer ")
  )
    return reply(response, 403, { error: "INVALID_CAPABILITY" });
  const body = await readBody(request);
  if (
    !authorizeCapability(
      request.headers.authorization?.replace(/^Bearer /, ""),
      { method: request.method, path: request.url, body, scope },
      identity,
    )
  )
    return reply(response, 403, { error: "INVALID_CAPABILITY" });
  if (scope === "health") {
    const health = await readiness();
    return reply(response, health.ready ? 200 : 503, {
      ...health,
      workspaceId: identity.workspaceId,
      generation: identity.generation,
    });
  }
  if (request.url === "/v1/superset-agents" && request.method === "POST") {
    const payload = JSON.parse(body);
    if (payload.codevWorkspaceId !== identity.workspaceId)
      return reply(response, 403, { error: "WORKSPACE_MISMATCH" });
  }
  if (request.url === "/v1/workspace/initialize") {
    const value = await initialize(JSON.parse(body));
    return reply(response, 200, value);
  }
  const upstream = await forward(request, body, guestUrl);
  response.writeHead(upstream.status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

export function createWorkspaceGateway(identity, readiness, guestPort = 5252) {
  if (identity.verificationKey.asymmetricKeyType !== "ed25519")
    throw new Error("Ed25519 verification key required");
  const guestUrl = `http://127.0.0.1:${guestPort}`;
  const initialize = workspaceBootstrap();
  const server = createServer((request, response) => {
    handle(request, response, identity, guestUrl, readiness, initialize).catch(
      (error) => {
        // Never return upstream exceptions or log headers, bodies or credentials.
        reply(response, error.message === "REQUEST_TOO_LARGE" ? 413 : 503, {
          error: "RUNTIME_UNAVAILABLE",
        });
      },
    );
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.timeout = 70_000;
  server.maxHeadersCount = 32;
  server.maxConnections = 64;
  server.on("upgrade", (_request, socket) => socket.destroy());
  return server;
}
