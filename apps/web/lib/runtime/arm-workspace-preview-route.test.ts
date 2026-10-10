import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  armWorkspacePreviewSuffix,
  ensureArmWorkspacePreviewRoute,
  isArmWorkspacePreviewHost,
} from "./arm-workspace-preview-route";

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

/** The rule every ready generation's tunnel already has. */
const gateway = {
  hostname: "codev-gateway-g3.trycodev.com",
  service: "http://127.0.0.1:5260",
};
const catchAll = { service: "http_status:404" };
const wildcard = { hostname: `*.${zone}`, service: "http://127.0.0.1:5261" };

const route = (workspaceId: string, port = 3000) => ({
  workspaceId,
  generation: 3,
  tunnelId: `tunnel-${workspaceId}`,
  gatewayHost: gateway.hostname,
  port,
  zone,
  zoneId,
});

const guards = () => ({
  reserve: vi.fn(async () => {}),
  confirmProxy: vi.fn(async () => {}),
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
    ARM_WORKSPACE_SIGNING_PRIVATE_KEY: "fixture",
    ARM_WORKSPACE_SIGNING_PUBLIC_KEY: "-----BEGIN PUBLIC KEY-----fixture",
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
    const state = fakeCloudflare([gateway, catchAll]);
    const checks = guards();
    const host = await ensureArmWorkspacePreviewRoute(
      route("ws-ingress"),
      checks,
    );
    expect(host).toBe(`p3000-${hash("ws-ingress")}-g3.${zone}`);
    expect(state.ingress).toEqual([gateway, wildcard, catchAll]);
    expect(state.records).toEqual([
      expect.objectContaining({
        type: "CNAME",
        name: host,
        content: "tunnel-ws-ingress.cfargotunnel.com",
        proxied: true,
      }),
    ]);
    expect(checks.reserve).toHaveBeenCalledTimes(1);
    expect(checks.confirmProxy).toHaveBeenCalledTimes(1);
    const calls = state.calls.length;
    await ensureArmWorkspacePreviewRoute(route("ws-ingress"), checks);
    expect(state.calls).toHaveLength(calls);
    expect(checks.reserve).toHaveBeenCalledTimes(1);
  });

  it("trusts a tunnel that already routes previews without asking the guest", async () => {
    const state = fakeCloudflare([gateway, wildcard, catchAll]);
    const checks = guards();
    await ensureArmWorkspacePreviewRoute(route("ws-routed"), checks);
    expect(state.calls.filter((call) => call.startsWith("PUT"))).toEqual([]);
    expect(checks.confirmProxy).not.toHaveBeenCalled();
  });

  it("routes nothing to a guest whose proxy does not own its port", async () => {
    const state = fakeCloudflare([gateway, catchAll]);
    const checks = guards();
    checks.confirmProxy.mockRejectedValueOnce(new Error("no proxy"));
    await expect(
      ensureArmWorkspacePreviewRoute(route("ws-legacy"), checks),
    ).rejects.toThrow("no proxy");
    expect(state.ingress).toEqual([gateway, catchAll]);
    expect(state.calls).toEqual([
      expect.stringMatching(/^GET .*\/configurations$/),
    ]);
  });

  it("never rewrites a tunnel that does not route its gateway", async () => {
    const state = fakeCloudflare([catchAll]);
    const checks = guards();
    await expect(
      ensureArmWorkspacePreviewRoute(route("ws-foreign"), checks),
    ).rejects.toThrow("CLOUDFLARE_TUNNEL_FAILED");
    expect(state.calls.filter((call) => !call.startsWith("GET"))).toEqual([]);
    expect(checks.confirmProxy).not.toHaveBeenCalled();
  });

  it("spends no Cloudflare budget once the member's reserve refuses", async () => {
    const state = fakeCloudflare([gateway, catchAll]);
    const checks = guards();
    checks.reserve.mockRejectedValueOnce(new Error("too many"));
    await expect(
      ensureArmWorkspacePreviewRoute(route("ws-budget"), checks),
    ).rejects.toThrow("too many");
    expect(state.calls).toEqual([]);
  });

  it("treats a record a concurrent mint created as success", async () => {
    const state = fakeCloudflare([gateway, wildcard, catchAll]);
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
      ensureArmWorkspacePreviewRoute(route("ws-race"), guards()),
    ).resolves.toBe(host);
  });

  it("replaces the oldest of four hosts in a generation and refuses foreign targets", async () => {
    const suffix = `-${hash("ws-cap")}-g3.${zone}`;
    const state = fakeCloudflare(
      [gateway, wildcard, catchAll],
      [4001, 4002, 4003, 4004].map((port, index) => ({
        id: `old-${port}`,
        name: `p${port}${suffix}`,
        content: "tunnel-ws-cap.cfargotunnel.com",
        created_on: `2026-10-0${4 - index}T00:00:00Z`,
      })),
    );
    await ensureArmWorkspacePreviewRoute(route("ws-cap"), guards());
    expect(state.records.map((record) => record.name).sort()).toEqual(
      [4001, 4002, 4003, 3000].map((port) => `p${port}${suffix}`).sort(),
    );
    state.records = [
      { id: "x", name: `p5000${suffix}`, content: "elsewhere", created_on: "" },
    ];
    await expect(
      ensureArmWorkspacePreviewRoute(route("ws-cap", 5000), guards()),
    ).rejects.toThrow("CLOUDFLARE_DNS_CONFLICT");
  });
});
