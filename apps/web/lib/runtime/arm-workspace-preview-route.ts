import "server-only";

import { signArmControlPlaneToken } from "./arm-control-plane-token";
import { ArmWorkspaceRuntimeError } from "./arm-workspace-error";
import {
  CLOUDFLARE_ACCOUNT_ID,
  cloudflareRequestDirect,
} from "./arm-workspace-provider";

/** The guest preview proxy's socket, owned by systemd from early boot. */
const PROXY_SERVICE = "http://127.0.0.1:5261";
/** Preview hosts kept per workspace generation; the oldest is replaced. */
const MAX_RECORDS = 4;
const INGRESS_CACHE_MS = 10 * 60_000;
/** Short, so a record another replica evicted is recreated soon. */
const DNS_CACHE_MS = 3 * 60_000;

type IngressRule = { hostname?: string; service: string };
type TunnelConfig = { ingress?: IngressRule[] };
type DnsRecord = {
  id: string;
  name: string;
  content: string;
  created_on?: string;
};

export type ArmWorkspacePreviewRoute = {
  workspaceId: string;
  generation: number;
  tunnelId: string;
  port: number;
  zone: string;
  zoneId: string;
};

/** Cloudflare state this process already confirmed, so repeat mints are free. */
const ensured = new Map<string, number>();

function isFresh(key: string) {
  return (ensured.get(key) ?? 0) > Date.now();
}

function remember(key: string, lifetimeMs: number) {
  if (ensured.size >= 1_000) ensured.clear();
  ensured.set(key, Date.now() + lifetimeMs);
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Preview hosts are `p<port>` plus this suffix,
 * `-<sha256(workspace)[0:20]>-g<generation>.<zone>`: one origin per port,
 * like localhost, one level deep for Universal SSL, and gone with the
 * generation. The guest proxy checks the same label.
 */
export async function armWorkspacePreviewSuffix(
  workspaceId: string,
  generation: number,
  zone: string,
) {
  const hash = (await sha256Hex(workspaceId)).slice(0, 20);
  return `-${hash}-g${generation}.${zone}`;
}

/** Whether a DNS name in `zone` is a preview host this module creates. */
export function isArmWorkspacePreviewHost(name: string, zone: string) {
  return (
    name.endsWith(`.${zone}`) &&
    /^p\d{1,5}-[0-9a-f]{20}-g\d{1,9}$/.test(name.slice(0, -zone.length - 1))
  );
}

/**
 * Lifecycle starts write a tunnel's ingress without previews, so the first
 * mint adds the wildcard rule. Every other rule stays, and the catch-all
 * stays last. A tunnel only receives hostnames whose CNAME points at it.
 */
async function ensureIngress(tunnelId: string, zone: string) {
  const key = `ingress:${tunnelId}:${zone}`;
  if (isFresh(key)) return;
  const path = `/accounts/${CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${tunnelId}/configurations`;
  const current = await cloudflareRequestDirect<{
    config?: TunnelConfig | null;
  } | null>(path);
  const config = current?.config ?? {};
  const rules = config.ingress ?? [];
  const hostname = `*.${zone}`;
  if (
    !rules.some(
      (rule) => rule.hostname === hostname && rule.service === PROXY_SERVICE,
    )
  ) {
    const routed = rules.filter(
      (rule) => rule.hostname && rule.hostname !== hostname,
    );
    const fallback = rules.findLast((rule) => !rule.hostname) ?? {
      service: "http_status:404",
    };
    await cloudflareRequestDirect(path, "PUT", {
      config: {
        ...config,
        ingress: [...routed, { hostname, service: PROXY_SERVICE }, fallback],
      },
    });
  }
  remember(key, INGRESS_CACHE_MS);
}

async function createRecord(zoneId: string, host: string, target: string) {
  try {
    await cloudflareRequestDirect(`/zones/${zoneId}/dns_records`, "POST", {
      type: "CNAME",
      name: host,
      content: target,
      proxied: true,
      ttl: 1,
    });
  } catch (error) {
    // A concurrent mint may have created the same record first.
    const records = await cloudflareRequestDirect<DnsRecord[]>(
      `/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(host)}`,
    );
    if (!records.some((record) => record.content === target)) throw error;
  }
}

/** Keep at most `MAX_RECORDS` hosts per generation, replacing the oldest. */
async function ensureRecord(route: ArmWorkspacePreviewRoute, suffix: string) {
  const host = `p${route.port}${suffix}`;
  if (isFresh(`dns:${host}`)) return host;
  const target = `${route.tunnelId}.cfargotunnel.com`;
  const records = (
    await cloudflareRequestDirect<DnsRecord[]>(
      `/zones/${route.zoneId}/dns_records?type=CNAME&per_page=50&name.endswith=${encodeURIComponent(suffix)}`,
    )
  ).filter((record) => record.name.endsWith(suffix));
  const existing = records.find((record) => record.name === host);
  if (existing && existing.content !== target)
    throw new ArmWorkspaceRuntimeError("CLOUDFLARE_DNS_CONFLICT");
  if (!existing) {
    const oldest = records
      .toSorted((left, right) =>
        (left.created_on ?? "").localeCompare(right.created_on ?? ""),
      )
      .slice(0, Math.max(0, records.length - MAX_RECORDS + 1));
    for (const record of oldest) {
      ensured.delete(`dns:${record.name}`);
      await cloudflareRequestDirect(
        `/zones/${route.zoneId}/dns_records/${record.id}`,
        "DELETE",
      );
    }
    await createRecord(route.zoneId, host, target);
  }
  remember(`dns:${host}`, DNS_CACHE_MS);
  return host;
}

/**
 * Routes one preview host to the workspace's tunnel. Runs from the web app
 * on demand, never inside the budgeted lifecycle workflow; the reconcile
 * cron removes records of generations that are no longer ready.
 */
export async function ensureArmWorkspacePreviewRoute(
  route: ArmWorkspacePreviewRoute,
) {
  const suffix = await armWorkspacePreviewSuffix(
    route.workspaceId,
    route.generation,
    route.zone,
  );
  await ensureIngress(route.tunnelId, route.zone);
  return ensureRecord(route, suffix);
}

/**
 * A single-use, 60-second session token for exactly one preview host. Its
 * `aud` and `scope` keep the gateway from accepting it, and gateway
 * capabilities from opening previews.
 */
export function armWorkspacePreviewToken(input: {
  host: string;
  workspaceId: string;
  generation: number;
  port: number;
  userId: string;
  appOrigin: string;
}) {
  return signArmControlPlaneToken({
    aud: input.host,
    scope: "preview",
    workspaceId: input.workspaceId,
    generation: input.generation,
    port: input.port,
    sub: input.userId,
    appOrigin: input.appOrigin,
    jti: crypto.randomUUID(),
  });
}
