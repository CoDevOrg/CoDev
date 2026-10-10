import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  armWorkspacePreviewSuffix,
  armWorkspacePreviewToken,
  ensureArmWorkspacePreviewRoute,
  isArmWorkspacePreviewHost,
} from "./arm-workspace-preview-route";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const zone = "codev-preview.dev";
const zoneId = "0123456789abcdef0123456789abcdef";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 20);

type Rule = { hostname?: string; service: string };
type DnsRecord = {
  id: string;
  name: string;
  content: string;
  created_on: string;
};

/** Just enough of the Cloudflare API: tunnel configuration and DNS records. */
function fakeCloudflare(ingress: Rule[], records: DnsRecord[] = []) {
  const state = { ingress, records, calls: [] as string[], failCreate: false };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      const method = init.method ?? "GET";
      state.calls.push(`${method} ${url.pathname}`);
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      const ok = (result: unknown) => Response.json({ success: true, result });
      if (url.pathname.endsWith("/configurations")) {
        if (method === "PUT") state.ingress = body.config.ingress;
        return ok({ config: { ingress: state.ingress, originRequest: {} } });
      }
      if (method === "POST") {
        if (state.failCreate)
          return Response.json({ success: false }, { status: 400 });
        state.records.push({ id: `r${state.records.length + 1}`, ...body });
        return ok({});
      }
      if (method === "DELETE") {
        const id = url.pathname.split("/").at(-1);
        state.records = state.records.filter((record) => record.id !== id);
        return ok({ id });
      }
      const name = url.searchParams.get("name");
      const suffix = url.searchParams.get("name.endswith");
      return ok(
        state.records.filter(
          (record) =>
            (!name || record.name === name) &&
            (!suffix || record.name.endsWith(suffix)),
        ),
      );
    }),
  );
  return state;
}

const route = (workspaceId: string, port = 3000) => ({
  workspaceId,
  generation: 3,
  tunnelId: `tunnel-${workspaceId}`,
  port,
  zone,
  zoneId,
});

beforeEach(() => {
  const values = {
    AZURE_TENANT_ID: "tenant",
    ARM_WORKSPACE_AZURE_CLIENT_ID: "client",
    ARM_WORKSPACE_AZURE_CLIENT_SECRET: "fixture",
    AZURE_SUBSCRIPTION_ID: "subscription",
    ARM_WORKSPACE_RESOURCE_GROUP: "codev-arm-workspace-test",
    ARM_WORKSPACE_IMAGE_VERSION_ID:
      "/subscriptions/subscription/resourceGroups/codev-arm-workspace-test/providers/Microsoft.Compute/galleries/gallery/images/image/versions/1.0.10",
    ARM_WORKSPACE_SSH_PUBLIC_KEY: "ssh-ed25519 fixture",
    ARM_WORKSPACE_SIGNING_PRIVATE_KEY: privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64"),
    ARM_WORKSPACE_SIGNING_PUBLIC_KEY: publicKey
      .export({ format: "pem", type: "spki" })
      .toString(),
    CLOUDFLARE_API_TOKEN: "fixture",
  };
  Object.entries(values).forEach(([name, value]) => vi.stubEnv(name, value));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("preview hosts", () => {
  it("names one first-level host per port and generation", async () => {
    const suffix = await armWorkspacePreviewSuffix("ws-a", 3, zone);
    expect(suffix).toBe(`-${hash("ws-a")}-g3.${zone}`);
    expect(isArmWorkspacePreviewHost(`p3000${suffix}`, zone)).toBe(true);
    expect(isArmWorkspacePreviewHost(`a.p3000${suffix}`, zone)).toBe(false);
    expect(isArmWorkspacePreviewHost(`www.${zone}`, zone)).toBe(false);
    expect(isArmWorkspacePreviewHost(`p3000${suffix}.evil`, zone)).toBe(false);
  });
});

describe("preview routes", () => {
  it("adds the wildcard ingress once, keeping other rules and the catch-all last", async () => {
    const runtime = {
      hostname: "codev-x-g3.trycodev.com",
      service: "http://127.0.0.1:5260",
    };
    const state = fakeCloudflare([runtime, { service: "http_status:404" }]);
    const host = await ensureArmWorkspacePreviewRoute(route("ws-ingress"));
    expect(host).toBe(`p3000-${hash("ws-ingress")}-g3.${zone}`);
    expect(state.ingress).toEqual([
      runtime,
      { hostname: `*.${zone}`, service: "http://127.0.0.1:5261" },
      { service: "http_status:404" },
    ]);
    expect(state.records).toEqual([
      expect.objectContaining({
        type: "CNAME",
        name: host,
        content: "tunnel-ws-ingress.cfargotunnel.com",
        proxied: true,
      }),
    ]);
    const calls = state.calls.length;
    await ensureArmWorkspacePreviewRoute(route("ws-ingress"));
    expect(state.calls).toHaveLength(calls);
  });

  it("does not rewrite a tunnel that already routes previews", async () => {
    const state = fakeCloudflare([
      { hostname: `*.${zone}`, service: "http://127.0.0.1:5261" },
      { service: "http_status:404" },
    ]);
    await ensureArmWorkspacePreviewRoute(route("ws-routed"));
    expect(state.calls.filter((call) => call.startsWith("PUT"))).toEqual([]);
  });

  it("treats a record a concurrent mint created as success", async () => {
    const state = fakeCloudflare([]);
    state.failCreate = true;
    const host = `p3000-${hash("ws-race")}-g3.${zone}`;
    state.records.push({
      id: "other",
      name: host,
      content: "tunnel-ws-race.cfargotunnel.com",
      created_on: "2026-10-09T00:00:00Z",
    });
    const fetcher = vi.mocked(fetch);
    const original = fetcher.getMockImplementation()!;
    let listed = false;
    fetcher.mockImplementation(async (input, init) => {
      // The first listing misses the record created a moment later.
      const url = new URL(String(input));
      if (!listed && url.searchParams.has("name.endswith")) {
        listed = true;
        return Response.json({ success: true, result: [] });
      }
      return original(input, init);
    });
    await expect(
      ensureArmWorkspacePreviewRoute(route("ws-race")),
    ).resolves.toBe(host);
  });

  it("replaces the oldest of four hosts in a generation and refuses foreign targets", async () => {
    const suffix = `-${hash("ws-cap")}-g3.${zone}`;
    const state = fakeCloudflare(
      [],
      [4001, 4002, 4003, 4004].map((port, index) => ({
        id: `old-${port}`,
        name: `p${port}${suffix}`,
        content: "tunnel-ws-cap.cfargotunnel.com",
        created_on: `2026-10-0${4 - index}T00:00:00Z`,
      })),
    );
    await ensureArmWorkspacePreviewRoute(route("ws-cap"));
    expect(state.records.map((record) => record.name).sort()).toEqual(
      [4001, 4002, 4003, 3000].map((port) => `p${port}${suffix}`).sort(),
    );
    state.records = [
      { id: "x", name: `p5000${suffix}`, content: "elsewhere", created_on: "" },
    ];
    await expect(
      ensureArmWorkspacePreviewRoute(route("ws-cap", 5000)),
    ).rejects.toThrow("CLOUDFLARE_DNS_CONFLICT");
  });
});

describe("preview tokens", () => {
  it("signs a one-minute, single-use token bound to one host, port and member", async () => {
    const host = `p3000-${hash("ws-a")}-g3.${zone}`;
    const token = await armWorkspacePreviewToken({
      host,
      workspaceId: "ws-a",
      generation: 3,
      port: 3000,
      userId: "user-1",
      appOrigin: "https://www.trycodev.com",
    });
    const [header, payload, signature] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString());
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({
      alg: "EdDSA",
      typ: "JWT",
    });
    expect(claims).toEqual({
      iss: "codev-control-plane",
      aud: host,
      scope: "preview",
      workspaceId: "ws-a",
      generation: 3,
      port: 3000,
      sub: "user-1",
      appOrigin: "https://www.trycodev.com",
      jti: expect.stringMatching(/^[0-9a-f-]{36}$/),
      iat: expect.any(Number),
      exp: claims.iat + 60,
    });
    expect(claims).not.toHaveProperty("method");
    expect(
      verify(
        null,
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
    const again = await armWorkspacePreviewToken({
      host,
      workspaceId: "ws-a",
      generation: 3,
      port: 3000,
      userId: "user-1",
      appOrigin: "https://www.trycodev.com",
    });
    expect(again).not.toBe(token);
  });
});
