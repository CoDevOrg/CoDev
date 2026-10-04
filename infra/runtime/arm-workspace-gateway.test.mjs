import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { authorizeCapability } from "./scripts/arm-workspace-capability.mjs";
import { createWorkspaceGateway } from "./scripts/arm-workspace-gateway.mjs";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const identity = {
  workspaceId: "workspace-a",
  generation: 2,
  audience: "runtime-a.trycodev.com",
  verificationKey: publicKey,
};
const request = {
  method: "GET",
  path: "/v1/health",
  scope: "health",
  body: Buffer.alloc(0),
};
const now = 1_800_000_000_000;

function token(patch = {}, header = {}) {
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const claims = {
    iss: "codev-control-plane",
    aud: identity.audience,
    workspaceId: identity.workspaceId,
    generation: identity.generation,
    method: request.method,
    path: request.path,
    scope: request.scope,
    bodySha256: createHash("sha256").update(request.body).digest("hex"),
    iat: now / 1000,
    exp: now / 1000 + 60,
    ...patch,
  };
  const data = `${encode({ alg: "EdDSA", typ: "JWT", ...header })}.${encode(claims)}`;
  return `${data}.${sign(null, Buffer.from(data), privateKey).toString("base64url")}`;
}

test("valid short-lived capability binds the complete request", () => {
  assert.equal(authorizeCapability(token(), request, identity, now), true);
});

for (const patch of [
  { workspaceId: "workspace-b" },
  { generation: 1 },
  { aud: "runtime-b.trycodev.com" },
  { iss: "another-issuer" },
  { scope: "workspace" },
  { method: "POST" },
  { path: "/v1/files/read" },
  { bodySha256: "bad" },
  { exp: now / 1000 },
  { exp: now / 1000 + 61 },
  { iat: now / 1000 + 1 },
  { exp: "1800000060" },
]) {
  test(`rejects ${JSON.stringify(patch)}`, () => {
    assert.equal(
      authorizeCapability(token(patch), request, identity, now),
      false,
    );
  });
}

test("rejects missing, malformed, forged and algorithm-confused tokens", () => {
  for (const value of [undefined, "a.b.c", "", token({}, { alg: "none" })])
    assert.equal(authorizeCapability(value, request, identity, now), false);
  const forged = `${token().split(".").slice(0, 2).join(".")}.AAAA`;
  assert.equal(authorizeCapability(forged, request, identity, now), false);
});

test("authenticated health is read-only; unknown and privileged routes fail closed", async (t) => {
  let checks = 0;
  const server = createWorkspaceGateway(identity, async () => {
    checks += 1;
    return { ready: true, diskMounted: true };
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${url}/v1/health`)).status, 403);
  assert.equal(checks, 0);
  const seconds = Math.floor(Date.now() / 1000);
  const response = await fetch(`${url}/v1/health`, {
    headers: {
      authorization: `Bearer ${token({ iat: seconds, exp: seconds + 60 })}`,
    },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).generation, 2);
  assert.equal(checks, 1);
  for (const path of [
    "/v1/claude-auth-login",
    "/v1/workspace/flush",
    "/healthz",
  ])
    assert.equal(
      (await fetch(`${url}${path}`, { method: "POST" })).status,
      404,
    );
  const traversalStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: "127.0.0.1",
        port: server.address().port,
        path: "/v1/files/%2e%2e/pty/exec",
        method: "POST",
      },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    request.on("error", reject);
    request.end();
  });
  assert.equal(traversalStatus, 404);
});

test("signed workspace commands reach only the guest and bind the exact body", async (t) => {
  const seen = [];
  const guest = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen.push({
      path: req.url,
      body: Buffer.concat(chunks).toString(),
      authorization: req.headers.authorization,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ output: "workspace", exitCode: 0 }));
  });
  guest.listen(0, "127.0.0.1");
  await once(guest, "listening");
  const gateway = createWorkspaceGateway(
    identity,
    async () => ({ ready: true }),
    guest.address().port,
  );
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  t.after(async () => {
    await new Promise((resolve) => gateway.close(resolve));
    await new Promise((resolve) => guest.close(resolve));
  });
  const url = `http://127.0.0.1:${gateway.address().port}`;
  const body = JSON.stringify({ command: ["pwd"] });
  const seconds = Math.floor(Date.now() / 1000);
  const capability = token({
    method: "POST",
    path: "/v1/pty/exec",
    scope: "workspace",
    bodySha256: createHash("sha256").update(body).digest("hex"),
    iat: seconds,
    exp: seconds + 60,
  });
  const init = {
    method: "POST",
    headers: { authorization: `Bearer ${capability}` },
    body,
  };
  const response = await fetch(`${url}/v1/pty/exec`, init);
  assert.equal(response.status, 200);
  assert.deepEqual(seen, [
    { path: "/v1/pty/exec", body, authorization: undefined },
  ]);
  assert.equal(
    (await fetch(`${url}/v1/pty/exec`, { ...init, body: "{}" })).status,
    403,
  );
  assert.equal((await fetch(`${url}/v1/codex-execs`, init)).status, 403);
  assert.equal(seen.length, 1);
});
