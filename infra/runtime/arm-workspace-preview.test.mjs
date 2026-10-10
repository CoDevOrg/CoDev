import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createWorkspacePreviewProxy,
  previewNextPath,
} from "./scripts/arm-workspace-preview.mjs";
import {
  PREVIEW_SESSION_CAP_MS,
  PREVIEW_SESSION_TTL_MS,
  createPreviewSessions,
  createTokenReplayGuard,
  previewHostPort,
  verifyPreviewToken,
} from "./scripts/arm-workspace-preview-token.mjs";
import {
  downstreamResponseHeaders,
  listListeningPorts,
  previewUpstream,
} from "./scripts/arm-workspace-preview-upstream.mjs";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const identity = {
  workspaceId: "8a1f2c9e-0d4b-4f53-9a51-3b0f7f0a4c11",
  generation: 2,
};
const hash = createHash("sha256")
  .update(identity.workspaceId)
  .digest("hex")
  .slice(0, 20);
const hostFor = (port) => `p${port}-${hash}-g2.preview.example.test`;
const appOrigin = "https://www.trycodev.com";
const now = 1_800_000_000_000;
let sequence = 0;

function token(port, patch = {}, header = {}) {
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  sequence += 1;
  const claims = {
    iss: "codev-control-plane",
    aud: hostFor(port),
    scope: "preview",
    workspaceId: identity.workspaceId,
    generation: identity.generation,
    port,
    sub: "user-1",
    appOrigin,
    jti: `preview-token-${String(sequence).padStart(8, "0")}`,
    iat: now / 1000,
    exp: now / 1000 + 60,
    ...patch,
  };
  const data = `${encode({ alg: "EdDSA", typ: "JWT", ...header })}.${encode(claims)}`;
  return `${data}.${sign(null, Buffer.from(data), privateKey).toString("base64url")}`;
}

const expected = (port = 3000, overrides = {}) => ({
  host: hostFor(port),
  port,
  identity,
  verifyKey: publicKey,
  claimToken: createTokenReplayGuard(),
  now,
  ...overrides,
});

test("a valid preview token yields its member and app origin exactly once", () => {
  const check = expected();
  const value = token(3000);
  assert.deepEqual(verifyPreviewToken(value, check), {
    sub: "user-1",
    appOrigin,
  });
  assert.equal(verifyPreviewToken(value, check), null);
});

for (const patch of [
  { iss: "another-issuer" },
  { aud: hostFor(3001) },
  { scope: "workspace" },
  { workspaceId: "workspace-b" },
  { generation: 1 },
  { port: 3001 },
  { port: "3000" },
  { exp: now / 1000 },
  { exp: now / 1000 + 61 },
  { iat: now / 1000 + 1 },
  { exp: "1800000060" },
  { sub: undefined },
  { sub: "" },
  { appOrigin: undefined },
  { appOrigin: "https://www.trycodev.com/gen2" },
  { appOrigin: "http://evil.example" },
  { appOrigin: "https://a.example; script-src *" },
  { jti: undefined },
  { jti: "short" },
]) {
  const label = JSON.stringify(patch, (_key, value) => value ?? "<missing>");
  test(`rejects preview token ${label}`, () => {
    assert.equal(verifyPreviewToken(token(3000, patch), expected()), null);
  });
}

test("rejects gateway capabilities, forged, malformed and algorithm-confused tokens", () => {
  const capability = token(3000, {
    aud: "codev-runtime.trycodev.com",
    scope: "workspace",
    method: "GET",
    path: "/v1/health",
  });
  const forged = `${token(3000).split(".").slice(0, 2).join(".")}.AAAA`;
  for (const value of [
    capability,
    forged,
    token(3000, {}, { alg: "none" }),
    undefined,
    "",
    "a.b.c",
    "a".repeat(9000),
  ])
    assert.equal(verifyPreviewToken(value, expected()), null);
});

test("the replay guard forgets only expired tokens and fails closed when full", () => {
  const claim = createTokenReplayGuard(2);
  assert.equal(claim("a", now + 60_000, now), true);
  assert.equal(claim("a", now + 60_000, now), false);
  assert.equal(claim("b", now + 60_000, now), true);
  assert.equal(claim("c", now + 60_000, now), false);
  assert.equal(claim("c", now + 120_000, now + 61_000), true);
  assert.equal(claim("a", now + 120_000, now + 61_000), true);
});

test("preview hosts must carry this workspace's canonical label", () => {
  assert.equal(previewHostPort(hostFor(3000), identity), 3000);
  assert.equal(previewHostPort(hostFor(65535), identity), 65535);
  for (const host of [
    hostFor(65536),
    hostFor(0),
    `p03000-${hash}-g2.preview.example.test`,
    `p3000-${hash}-g3.preview.example.test`,
    `p3000-${"0".repeat(20)}-g2.preview.example.test`,
    `p3000-${hash}-g2.test`,
    `${hostFor(3000)}:443`,
    hostFor(3000).toUpperCase(),
    undefined,
  ])
    assert.equal(previewHostPort(host, identity), null, host);
});

test("sessions renew after half their lifetime and end at the 30-minute cap", () => {
  const sessions = createPreviewSessions();
  const host = hostFor(3000);
  const pair = (cookie) => cookie.split(";")[0];
  const issued = sessions.issue({ host, port: 3000, sub: "u", appOrigin }, now);
  assert.match(
    issued,
    /; Max-Age=300; Path=\/; Secure; HttpOnly; SameSite=None; Partitioned$/,
  );
  let session = sessions.read(pair(issued), host, 3000, now);
  assert.equal(session.exp, now + PREVIEW_SESSION_TTL_MS);
  assert.equal(sessions.renew(session, now + 60_000), null);
  assert.equal(sessions.read(pair(issued), hostFor(3001), 3001, now), null);
  assert.equal(sessions.read(pair(issued), host, 3000, session.exp), null);
  assert.equal(
    createPreviewSessions().read(pair(issued), host, 3000, now),
    null,
  );
  let clock = now;
  for (;;) {
    clock = session.exp - PREVIEW_SESSION_TTL_MS / 2 + 1000;
    const renewed = sessions.renew(session, clock);
    if (!renewed) break;
    session = sessions.read(pair(renewed), host, 3000, clock);
  }
  assert.equal(session.exp, now + PREVIEW_SESSION_CAP_MS);
  assert.equal(session.cap, now + PREVIEW_SESSION_CAP_MS);
  assert.equal(
    sessions.read(
      `__Host-codev-preview=${pair(issued).split("=")[1]}x`,
      host,
      3000,
      now,
    ),
    null,
  );
});

test("the next path never leaves the preview origin", () => {
  const host = hostFor(3000);
  assert.equal(
    previewNextPath("/dashboard?tab=1#top", host),
    "/dashboard?tab=1#top",
  );
  assert.equal(previewNextPath("app/page", host), "/app/page");
  for (const next of [
    "/\\evil.example",
    "//evil.example",
    "/.//evil.example/x",
    "https://evil.example/",
    `https://${hostFor(3001)}/`,
    "javascript:alert(1)",
    "/__codev/preview/session?token=x",
    null,
    "/".repeat(3000),
  ])
    assert.equal(previewNextPath(next, host), "/", String(next).slice(0, 40));
});

test("lists LISTEN sockets from /proc with their owners and addresses", async () => {
  const header =
    "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode";
  const row = (local, state, uid) =>
    `   0: ${local} 00000000:0000 ${state} 00000000:00000000 00:00000000 00000000 ${uid}        0 1 1 0000000000000000 100 0 0 10 0`;
  const files = {
    "/proc/net/tcp": [
      header,
      row("0100007F:0BB8", "0A", 2000),
      row("00000000:1F90", "0A", 0),
      row("0100007F:D431", "01", 2000),
    ].join("\n"),
    "/proc/net/tcp6": [
      header,
      row("00000000000000000000000001000000:1538", "0A", 2001),
      row("00000000000000000000000000000000:1389", "0A", 100000),
      row("0000000000000000FFFF00000100007F:0050", "0A", 2000),
      row("B80D0120000000000000000001000000:0016", "0A", 0),
    ].join("\n"),
  };
  const read = async (path) => files[path];
  assert.deepEqual(await listListeningPorts(read), [
    { address: "127.0.0.1", port: 3000, uid: 2000 },
    { address: "0.0.0.0", port: 8080, uid: 0 },
    { address: "::1", port: 5432, uid: 2001 },
    { address: "::", port: 5001, uid: 100000 },
    { address: "127.0.0.1", port: 80, uid: 2000 },
    { address: "2001:db8:0:0:0:0:0:1", port: 22, uid: 0 },
  ]);
  const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
  const ipv4Only = async (path) => {
    if (path.endsWith("6")) throw missing;
    return files[path];
  };
  assert.equal((await listListeningPorts(ipv4Only)).length, 2);
  await assert.rejects(listListeningPorts(async () => Promise.reject(missing)));
});

test("only member-owned loopback listeners outside reserved ports are reachable", () => {
  const rows = (...list) =>
    list.map(([address, port, uid]) => ({ address, port, uid }));
  assert.deepEqual(
    previewUpstream(rows(["::1", 3000, 2000], ["0.0.0.0", 3000, 2000]), 3000),
    { host: "127.0.0.1" },
  );
  assert.deepEqual(previewUpstream(rows(["::", 3000, 100000]), 3000), {
    host: "::1",
  });
  assert.deepEqual(previewUpstream(rows(["127.0.0.1", 3000, 1000]), 3000), {
    error: "forbidden",
  });
  assert.deepEqual(
    previewUpstream(rows(["127.0.0.1", 3000, 2000], ["::1", 3000, 0]), 3000),
    { error: "forbidden" },
  );
  assert.deepEqual(previewUpstream(rows(["10.0.0.4", 3000, 2000]), 3000), {
    error: "not_listening",
  });
  assert.deepEqual(previewUpstream(rows(), 3000), { error: "not_listening" });
  for (const port of [9, 4879, 5252, 5260, 5261, 20241, 20245])
    assert.deepEqual(previewUpstream(rows(["127.0.0.1", port, 2000]), port), {
      error: "forbidden",
    });
});

test("response rewrites keep previews out of shared caches and frameable only by CoDev", () => {
  const rewrite = (...raw) => {
    const flat = downstreamResponseHeaders(raw, { port: 3000, appOrigin });
    const result = [];
    for (let at = 0; at < flat.length; at += 2)
      result.push([flat[at].toLowerCase(), flat[at + 1]]);
    return result;
  };
  const values = (headers, name) =>
    headers.filter(([key]) => key === name).map(([, value]) => value);
  const plain = rewrite("Content-Type", "text/html");
  assert.deepEqual(values(plain, "cache-control"), ["private"]);
  assert.deepEqual(values(plain, "cloudflare-cdn-cache-control"), ["no-store"]);
  assert.deepEqual(values(plain, "content-security-policy"), [
    `frame-ancestors ${appOrigin}`,
  ]);
  const policies = rewrite(
    "Cache-Control",
    "public, s-maxage=600, max-age=60",
    "Content-Security-Policy",
    "frame-ancestors 'none'",
    "Content-Security-Policy-Report-Only",
    "default-src 'self'; Frame-Ancestors 'self'",
    "Location",
    "http://127.0.0.1:3000",
  );
  assert.deepEqual(values(policies, "cache-control"), ["private, max-age=60"]);
  assert.deepEqual(values(policies, "content-security-policy"), [
    `frame-ancestors ${appOrigin}`,
  ]);
  assert.deepEqual(values(policies, "content-security-policy-report-only"), [
    "default-src 'self'",
  ]);
  assert.deepEqual(values(policies, "location"), ["/"]);
  assert.deepEqual(
    values(rewrite("Location", "http://localhost:30001/x"), "location"),
    ["http://localhost:30001/x"],
  );
  for (const location of [
    "http://localhost:3000//evil.example/",
    "http://localhost:3000/\\evil.example/",
  ])
    assert.deepEqual(values(rewrite("Location", location), "location"), [
      location,
    ]);
  assert.deepEqual(
    values(rewrite("Location", "HTTP://[::1]:3000?next=1"), "location"),
    ["/?next=1"],
  );
});

// Upgraded sockets outlive closeAllConnections(); destroy every socket so a
// failed assertion can never leave server.close() waiting.
async function listen(t, server, address) {
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.listen(0, address);
  await once(server, "listening");
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise((resolve) => server.close(resolve));
  });
  return server;
}

async function startProxy(t, options = {}) {
  const clock = options.clock ?? { now };
  const proxy = createWorkspacePreviewProxy({
    identity,
    verifyKey: publicKey,
    listListeningPorts:
      options.listListeningPorts ?? (async () => options.sockets ?? []),
    now: () => clock.now,
  });
  return listen(t, proxy, "127.0.0.1");
}

async function startUpstream(t, handler, address = "127.0.0.1") {
  return listen(t, createServer(handler), address);
}

function send(proxy, { host, path = "/", method = "GET", headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port: proxy.address().port,
        method,
        path,
        headers: { host, ...headers },
        agent: false,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            rawHeaders: response.rawHeaders,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

async function login(proxy, port, patch = {}) {
  const response = await send(proxy, {
    host: hostFor(port),
    path: `/__codev/preview/session?token=${token(port, patch)}&next=%2F`,
  });
  assert.equal(response.status, 303);
  return response.headers["set-cookie"][0].split(";")[0];
}

test("the session link sets a partitioned host cookie and the check page lands on next", async (t) => {
  const proxy = await startProxy(t);
  const host = hostFor(3000);
  const link = token(3000);
  const path = `/__codev/preview/session?token=${link}&next=${encodeURIComponent("/dashboard?tab=1#top")}`;
  const session = await send(proxy, { host, path });
  assert.equal(session.status, 303);
  assert.equal(
    session.headers.location,
    "/__codev/preview/check?next=%2Fdashboard%3Ftab%3D1%23top",
  );
  assert.match(
    session.headers["set-cookie"][0],
    /^__Host-codev-preview=[\w-]+\.[\w-]+; Max-Age=300; Path=\/; Secure; HttpOnly; SameSite=None; Partitioned$/,
  );
  for (const response of [session])
    assert.deepEqual(
      [
        response.headers["cache-control"],
        response.headers["cloudflare-cdn-cache-control"],
        response.headers["referrer-policy"],
      ],
      ["no-store", "no-store", "no-referrer"],
    );
  assert.equal((await send(proxy, { host, path })).status, 401);
  const cookie = session.headers["set-cookie"][0].split(";")[0];
  const landed = await send(proxy, {
    host,
    path: session.headers.location,
    headers: { cookie },
  });
  assert.equal(landed.status, 303);
  assert.equal(landed.headers.location, "/dashboard?tab=1#top");
  assert.equal(landed.headers["cache-control"], "no-store");
  const escaped = await send(proxy, {
    host,
    path: `/__codev/preview/session?token=${token(3000)}&next=${encodeURIComponent("/\\evil.example")}`,
  });
  assert.equal(escaped.headers.location, "/__codev/preview/check?next=%2F");
  assert.equal((await send(proxy, { host, path, method: "POST" })).status, 405);
  assert.equal(
    (
      await send(proxy, {
        host,
        path: "/__codev/preview/other",
        headers: { cookie },
      })
    ).status,
    404,
  );
});

test("without an embedded cookie the check page offers storage access under a strict CSP", async (t) => {
  const proxy = await startProxy(t);
  const page = await send(proxy, {
    host: hostFor(3000),
    path: "/__codev/preview/check?next=%2F",
  });
  assert.equal(page.status, 200);
  assert.match(page.headers["content-type"], /^text\/html/);
  assert.equal(page.headers["cache-control"], "no-store");
  assert.equal(page.headers["referrer-policy"], "no-referrer");
  assert.match(page.body, /document\.requestStorageAccess\(\)/);
  assert.match(page.body, /Open in new tab/);
  const nonce =
    page.headers["content-security-policy"].match(/'nonce-([^']+)'/)[1];
  assert.match(page.headers["content-security-policy"], /^default-src 'none';/);
  assert.ok(page.body.includes(`<script nonce="${nonce}">`));
});

test("requests need this host's session and this workspace's preview label", async (t) => {
  let calls = 0;
  const upstream = await startUpstream(t, (_request, response) => {
    calls += 1;
    response.end("ok");
  });
  const port = upstream.address().port;
  const proxy = await startProxy(t, {
    sockets: [{ address: "127.0.0.1", port, uid: 2000 }],
  });
  const anonymous = await send(proxy, { host: hostFor(port) });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body, "Open this preview from CoDev.");
  assert.equal(anonymous.headers["cache-control"], "no-store");
  const cookie = await login(proxy, port);
  const elsewhere = `p${port}-${"0".repeat(20)}-g2.preview.example.test`;
  assert.equal(
    (await send(proxy, { host: elsewhere, headers: { cookie } })).status,
    421,
  );
  assert.equal(
    (await send(proxy, { host: hostFor(port + 1), headers: { cookie } }))
      .status,
    401,
  );
  const expired = await send(proxy, {
    host: hostFor(port),
    path: `/__codev/preview/session?token=${token(port, { exp: now / 1000 })}`,
  });
  assert.equal(expired.status, 401);
  assert.equal(expired.headers["cache-control"], "no-store");
  assert.equal(calls, 0);
  assert.equal(
    (await send(proxy, { host: hostFor(port), headers: { cookie } })).status,
    200,
  );
  assert.equal(calls, 1);
});

test("proxies a member's dev server with rewritten, streamed requests and responses", async (t) => {
  const seen = [];
  const upstream = await startUpstream(t, async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    seen.push({
      url: request.url,
      headers: request.headers,
      body: Buffer.concat(chunks).toString(),
    });
    const port = request.socket.localPort;
    if (request.url === "/redirect") {
      response.writeHead(302, {
        Location: `http://localhost:${port}/login?next=%2F`,
      });
      return response.end();
    }
    response.writeHead(200, [
      "Content-Type",
      "text/javascript",
      "Cache-Control",
      "public, max-age=31536000, immutable",
      "CDN-Cache-Control",
      "max-age=600",
      "X-Frame-Options",
      "DENY",
      "Content-Security-Policy",
      "default-src 'self'; frame-ancestors 'none'",
      "Set-Cookie",
      "app=1; Path=/",
      "Set-Cookie",
      "__Host-codev-preview=planted; Path=/; Secure",
      "Connection",
      "x-hop",
      "X-Hop",
      "drop",
    ]);
    response.write("hello ");
    setTimeout(
      () => response.end(`world ${Buffer.concat(chunks).toString()}`),
      20,
    );
  });
  const port = upstream.address().port;
  const host = hostFor(port);
  const proxy = await startProxy(t, {
    sockets: [{ address: "127.0.0.1", port, uid: 2000 }],
  });
  const cookie = await login(proxy, port);
  const response = await send(proxy, {
    host,
    path: "/assets/app.js?v=1",
    headers: {
      cookie: `theme=dark; ${cookie}; other=1`,
      referer: `https://${host}/index.html?x=1`,
      "x-forwarded-for": "203.0.113.9",
      "x-forwarded-host": "evil.example",
      forwarded: "for=203.0.113.9",
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "no-cors",
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body, "hello world ");
  assert.equal(seen[0].url, "/assets/app.js?v=1");
  assert.equal(seen[0].headers.host, `localhost:${port}`);
  assert.equal(seen[0].headers.cookie, "theme=dark; other=1");
  assert.equal(
    seen[0].headers.referer,
    `http://localhost:${port}/index.html?x=1`,
  );
  for (const name of [
    "x-forwarded-for",
    "x-forwarded-host",
    "forwarded",
    "origin",
  ])
    assert.equal(seen[0].headers[name], undefined, name);
  assert.equal(
    response.headers["cache-control"],
    "private, max-age=31536000, immutable",
  );
  assert.equal(response.headers["cloudflare-cdn-cache-control"], "no-store");
  for (const name of ["cdn-cache-control", "x-frame-options", "x-hop"])
    assert.equal(response.headers[name], undefined, name);
  const policies = [];
  for (let at = 0; at < response.rawHeaders.length; at += 2)
    if (response.rawHeaders[at].toLowerCase() === "content-security-policy")
      policies.push(response.rawHeaders[at + 1]);
  assert.deepEqual(policies, [
    "default-src 'self'",
    `frame-ancestors ${appOrigin}`,
  ]);
  assert.deepEqual(response.headers["set-cookie"], ["app=1; Path=/"]);
  const posted = await send(proxy, {
    host,
    method: "POST",
    path: "/api/echo",
    headers: {
      cookie,
      origin: `https://${host}`,
      "content-type": "text/plain",
    },
    body: "payload",
  });
  assert.equal(posted.body, "hello world payload");
  assert.equal(seen[1].headers.origin, `http://localhost:${port}`);
  assert.equal(seen[1].body, "payload");
  const redirected = await send(proxy, {
    host,
    path: "/redirect",
    headers: { cookie },
  });
  assert.equal(redirected.status, 302);
  assert.equal(redirected.headers.location, "/login?next=%2F");
  assert.equal(redirected.headers["cloudflare-cdn-cache-control"], "no-store");
});

test("chunked bodies stay framed for every method, so none smuggles a second request", async (t) => {
  const seen = [];
  const upstream = await startUpstream(t, async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    seen.push(`${request.method} ${request.url} ${body}`);
    response.end(body);
  });
  const port = upstream.address().port;
  const host = hostFor(port);
  const proxy = await startProxy(t, {
    sockets: [{ address: "127.0.0.1", port, uid: 2000 }],
  });
  const cookie = await login(proxy, port);
  const smuggled = "GET /smuggled HTTP/1.1\r\nHost: localhost\r\n\r\n";
  for (const method of ["DELETE", "OPTIONS", "GET", "POST"]) {
    const response = await send(proxy, {
      host,
      method,
      path: "/api/x",
      headers: {
        cookie,
        origin: `https://${host}`,
        "transfer-encoding": "chunked",
      },
      body: smuggled,
    });
    assert.equal(response.status, 200, method);
    assert.equal(response.body, smuggled, method);
  }
  assert.deepEqual(
    seen,
    ["DELETE", "OPTIONS", "GET", "POST"].map(
      (method) => `${method} /api/x ${smuggled}`,
    ),
  );
});

test("cross-origin and cross-site requests are refused before anything is rewritten", async (t) => {
  let calls = 0;
  const upstream = await startUpstream(t, (_request, response) => {
    calls += 1;
    response.end("ok");
  });
  const port = upstream.address().port;
  const host = hostFor(port);
  const proxy = await startProxy(t, {
    sockets: [{ address: "127.0.0.1", port, uid: 2000 }],
  });
  const cookie = await login(proxy, port);
  const status = async (method, headers) =>
    (await send(proxy, { host, method, headers: { cookie, ...headers } }))
      .status;
  assert.equal(await status("POST", {}), 403);
  assert.equal(
    await status("POST", { origin: `https://${hostFor(port + 1)}` }),
    403,
  );
  assert.equal(await status("DELETE", { origin: "null" }), 403);
  assert.equal(await status("GET", { origin: "https://evil.example" }), 403);
  assert.equal(
    await status("GET", {
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "cors",
    }),
    403,
  );
  assert.equal(
    await status("GET", {
      "sec-fetch-site": "same-site",
      "sec-fetch-mode": "no-cors",
    }),
    403,
  );
  assert.equal(calls, 0);
  assert.equal(
    await status("GET", {
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "navigate",
    }),
    200,
  );
  assert.equal(
    await status("GET", {
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
    }),
    200,
  );
  assert.equal(await status("POST", { origin: `https://${host}` }), 200);
  assert.equal(calls, 3);
});

test("ports owned by root, the image builder or reserved services are never reached", async (t) => {
  const sockets = [];
  const proxy = await startProxy(t, { sockets });
  const attempt = async (port, rows) => {
    sockets.splice(0, sockets.length, ...rows);
    return send(proxy, {
      host: hostFor(port),
      headers: { cookie: await login(proxy, port) },
    });
  };
  const forbidden = await attempt(5252, [
    { address: "127.0.0.1", port: 5252, uid: 2000 },
  ]);
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body, "Port 5252 can't be previewed.");
  assert.equal(
    (await attempt(20243, [{ address: "127.0.0.1", port: 20243, uid: 2000 }]))
      .status,
    403,
  );
  assert.equal(
    (await attempt(4000, [{ address: "127.0.0.1", port: 4000, uid: 1000 }]))
      .status,
    403,
  );
  assert.equal(
    (
      await attempt(4000, [
        { address: "::1", port: 4000, uid: 2000 },
        { address: "127.0.0.1", port: 4000, uid: 0 },
      ])
    ).status,
    403,
  );
  assert.equal(
    (await attempt(4000, [{ address: "10.0.0.4", port: 4000, uid: 2000 }]))
      .status,
    502,
  );
  assert.equal((await attempt(4000, [])).status, 502);
});

test("connects only to the address family of the member's LISTEN row", async (t) => {
  const upstream = await startUpstream(t, (_request, response) =>
    response.end("v4"),
  );
  const port = upstream.address().port;
  const sockets = [{ address: "::1", port, uid: 2000 }];
  const proxy = await startProxy(t, { sockets });
  const cookie = await login(proxy, port);
  const refused = await send(proxy, {
    host: hostFor(port),
    headers: { cookie },
  });
  assert.equal(refused.status, 502);
  assert.equal(refused.headers["cache-control"], "no-store");
  sockets[0].address = "0.0.0.0";
  assert.equal(
    (await send(proxy, { host: hostFor(port), headers: { cookie } })).body,
    "v4",
  );
});

test("an IPv6-only member listener is reached on ::1", async (t) => {
  let upstream;
  try {
    upstream = await startUpstream(
      t,
      (_request, response) => response.end("v6"),
      "::1",
    );
  } catch {
    return t.skip("IPv6 loopback is unavailable");
  }
  const port = upstream.address().port;
  const proxy = await startProxy(t, {
    sockets: [{ address: "::", port, uid: 100000 }],
  });
  const cookie = await login(proxy, port);
  assert.equal(
    (await send(proxy, { host: hostFor(port), headers: { cookie } })).body,
    "v6",
  );
});

test("cookies renew after half their lifetime until the session cap", async (t) => {
  const upstream = await startUpstream(t, (_request, response) =>
    response.end("ok"),
  );
  const port = upstream.address().port;
  const clock = { now };
  const proxy = await startProxy(t, {
    clock,
    sockets: [{ address: "127.0.0.1", port, uid: 2000 }],
  });
  const host = hostFor(port);
  const cookie = await login(proxy, port);
  clock.now = now + 60_000;
  assert.equal(
    (await send(proxy, { host, headers: { cookie } })).headers["set-cookie"],
    undefined,
  );
  clock.now = now + 151_000;
  const renewed = await send(proxy, { host, headers: { cookie } });
  assert.match(
    renewed.headers["set-cookie"][0],
    /; Max-Age=300; Path=\/; Secure; HttpOnly; SameSite=None; Partitioned$/,
  );
  const next = renewed.headers["set-cookie"][0].split(";")[0];
  clock.now = now + 301_000;
  assert.equal((await send(proxy, { host, headers: { cookie } })).status, 401);
  assert.equal(
    (await send(proxy, { host, headers: { cookie: next } })).status,
    200,
  );
});

test("port listing failures fail closed without detail", async (t) => {
  const proxy = await startProxy(t, {
    listListeningPorts: async () => {
      throw new Error("EACCES /proc/net/tcp secret-detail");
    },
  });
  const response = await send(proxy, {
    host: hostFor(3000),
    headers: { cookie: await login(proxy, 3000) },
  });
  assert.equal(response.status, 503);
  assert.equal(response.body, "Preview is unavailable.");
});

function exchange(proxy, lines, early = Buffer.alloc(0)) {
  const socket = connect(proxy.address().port, "127.0.0.1");
  socket.write(
    Buffer.concat([Buffer.from(`${lines.join("\r\n")}\r\n\r\n`), early]),
  );
  let received = Buffer.alloc(0);
  const waiters = [];
  socket.on("data", (chunk) => {
    received = Buffer.concat([received, chunk]);
    for (const waiter of waiters.splice(0)) waiter();
  });
  const until = async (done) => {
    while (!done(received))
      await new Promise((resolve) => waiters.push(resolve));
    return received;
  };
  return {
    socket,
    until,
    ended: once(socket, "close").then(() => received.toString()),
  };
}

test("WebSocket upgrades pass the same checks and then pipe raw bytes", async (t) => {
  const seen = [];
  const upstream = await startUpstream(t, () => {});
  upstream.on("upgrade", (request, socket) => {
    seen.push(request.headers);
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
    );
    socket.pipe(socket);
  });
  const port = upstream.address().port;
  const host = hostFor(port);
  const proxy = await startProxy(t, {
    sockets: [{ address: "127.0.0.1", port, uid: 2000 }],
  });
  const cookie = await login(proxy, port);
  const handshake = (extra) => [
    "GET /_next/webpack-hmr HTTP/1.1",
    `Host: ${host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
    "Sec-WebSocket-Version: 13",
    "X-Forwarded-For: 203.0.113.9",
    ...extra,
  ];
  const live = exchange(
    proxy,
    handshake([`Origin: https://${host}`, `Cookie: ${cookie}; hmr=1`]),
  );
  const head = (
    await live.until((data) => data.includes("\r\n\r\n"))
  ).toString();
  assert.match(head, /^HTTP\/1\.1 101 Switching Protocols\r\n/);
  const frame = Buffer.from([0x82, 0x04, 0x00, 0xff, 0x0d, 0x0a]);
  const offset = head.indexOf("\r\n\r\n") + 4;
  live.socket.write(frame);
  const echoed = await live.until(
    (data) => data.length >= offset + frame.length,
  );
  assert.deepEqual(echoed.subarray(offset, offset + frame.length), frame);
  assert.equal(seen[0].host, `localhost:${port}`);
  assert.equal(seen[0].origin, `http://localhost:${port}`);
  assert.equal(seen[0].cookie, "hmr=1");
  assert.equal(seen[0]["x-forwarded-for"], undefined);
  assert.equal(seen[0].upgrade, "websocket");
  assert.equal(seen[0]["sec-websocket-key"], "dGhlIHNhbXBsZSBub25jZQ==");
  for (const [extra, status] of [
    [[`Cookie: ${cookie}`], 403],
    [[`Origin: https://${hostFor(port + 1)}`, `Cookie: ${cookie}`], 403],
    [[`Origin: https://${host}`], 401],
  ])
    assert.match(
      await exchange(proxy, handshake(extra)).ended,
      new RegExp(`^HTTP/1\\.1 ${status} `),
    );
  const other = handshake([`Origin: https://${host}`, `Cookie: ${cookie}`]).map(
    (line) => (line === "Upgrade: websocket" ? "Upgrade: h2c" : line),
  );
  assert.match(await exchange(proxy, other).ended, /^HTTP\/1\.1 400 /);
  assert.equal(seen.length, 1);
});

test("a WebSocket upgrade to a listener that is gone answers 502 and closes", async (t) => {
  const closed = createServer();
  closed.listen(0, "127.0.0.1");
  await once(closed, "listening");
  const port = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));
  const proxy = await startProxy(t, {
    sockets: [{ address: "127.0.0.1", port, uid: 2000 }],
  });
  const host = hostFor(port);
  const reply = await exchange(proxy, [
    "GET /ws HTTP/1.1",
    `Host: ${host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Origin: https://${host}`,
    `Cookie: ${await login(proxy, port)}`,
  ]).ended;
  assert.match(reply, /^HTTP\/1\.1 502 /);
  assert.match(reply, /Nothing is answering on port \d+\.$/);
});

test("only a 101 from the dev server reaches the browser, and early bytes wait for it", async (t) => {
  const early = [];
  const upstream = await startUpstream(t, () => {});
  upstream.on("upgrade", (request, socket, head) => {
    if (request.url === "/cached")
      return socket.end(
        "HTTP/1.1 200 OK\r\nCache-Control: public, max-age=31536000, immutable\r\n" +
          "X-Frame-Options: DENY\r\nContent-Length: 2\r\n\r\nok",
      );
    if (request.url === "/silent") return socket.end();
    early.push(head.length);
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        "Set-Cookie: __Host-codev-preview=planted; Path=/; Secure\r\nSet-Cookie: hmr=1\r\n\r\n",
    );
    socket.pipe(socket);
  });
  const port = upstream.address().port;
  const host = hostFor(port);
  const proxy = await startProxy(t, {
    sockets: [{ address: "127.0.0.1", port, uid: 2000 }],
  });
  const cookie = await login(proxy, port);
  const handshake = (path, extra = []) => [
    `GET ${path} HTTP/1.1`,
    `Host: ${host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Origin: https://${host}`,
    `Cookie: ${cookie}`,
    ...extra,
  ];
  for (const path of ["/cached", "/silent"]) {
    const reply = await exchange(proxy, handshake(path)).ended;
    assert.match(reply, /^HTTP\/1\.1 502 /, path);
    assert.match(reply, /\r\nCache-Control: no-store\r\n/, path);
    assert.match(reply, /\r\nCloudflare-CDN-Cache-Control: no-store\r\n/, path);
    assert.doesNotMatch(reply, /public|immutable|X-Frame-Options|\r\n\r\nok$/i);
  }
  const frame = Buffer.from([0x82, 0x02, 0x68, 0x69]);
  const live = exchange(proxy, handshake("/hmr"), frame);
  const received = await live.until((data) => {
    const end = data.indexOf("\r\n\r\n");
    return end >= 0 && data.length >= end + 4 + frame.length;
  });
  const end = received.indexOf("\r\n\r\n");
  const head = received.subarray(0, end).toString();
  assert.match(head, /^HTTP\/1\.1 101 /);
  assert.match(head, /\r\nSet-Cookie: hmr=1$/);
  assert.doesNotMatch(head, /codev-preview/);
  assert.deepEqual(received.subarray(end + 4), frame);
  assert.deepEqual(early, [0]);
  live.socket.destroy();
  for (const extra of [["Content-Length: 5"], ["Transfer-Encoding: chunked"]])
    assert.match(
      await exchange(proxy, handshake("/hmr", extra)).ended,
      /^HTTP\/1\.1 400 /,
    );
  assert.equal(early.length, 1);
});

test("the proxy bounds sockets and header time", async (t) => {
  const proxy = await startProxy(t);
  assert.equal(proxy.maxConnections, 256);
  assert.equal(proxy.headersTimeout, 30_000);
  assert.throws(
    () =>
      createWorkspacePreviewProxy({
        identity,
        verifyKey: generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey,
      }),
    /Ed25519/,
  );
});

test("the entrypoint serves systemd's fd 3 and holds the port before activation", async (t) => {
  const entrypoint = fileURLToPath(
    new URL("./scripts/start-arm-workspace-preview.mjs", import.meta.url),
  );
  // Like systemd: bind, hand the listener over as fd 3, then exec in place.
  const launcher = [
    "import os, socket, sys",
    "listener = socket.socket()",
    'listener.bind(("127.0.0.1", 0))',
    "listener.listen()",
    "print(listener.getsockname()[1], flush=True)",
    "if listener.fileno() != 3: os.dup2(listener.fileno(), 3)",
    "os.set_inheritable(3, True)",
    'os.environ.update(LISTEN_FDS="1", LISTEN_PID=str(os.getpid()))',
    "os.execv(sys.argv[1], sys.argv[1:])",
  ].join("\n");
  const child = spawn(
    "python3",
    ["-c", launcher, process.execPath, entrypoint],
    {
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  t.after(() => child.kill());
  const [port] = await once(child.stdout, "data");
  const response = await fetch(`http://127.0.0.1:${Number(port)}/`, {
    headers: { host: hostFor(3000) },
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), "Preview is not ready.");
});
