import "server-only";

import { checkRealtimeConnection } from "../gen2/collaboration-redis";
import { checkDatabaseConnection } from "../platform/database";

async function measured(check: () => Promise<unknown>) {
  const startedAt = Date.now();
  try {
    await check();
    return { status: "ready" as const, latencyMs: Date.now() - startedAt };
  } catch {
    return { status: "degraded" as const, latencyMs: Date.now() - startedAt };
  }
}

export async function getReadiness() {
  const [database, realtime] = await Promise.all([
    measured(checkDatabaseConnection),
    measured(checkRealtimeConnection),
  ]);
  // Guest readiness is checked per workspace; the web service does not depend
  // on an allocated guest or the retired shared Firecracker host.
  const ready = database.status === "ready" && realtime.status === "ready";
  return {
    status: ready ? ("ready" as const) : ("degraded" as const),
    service: "codev-web",
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? "development",
    // Azure deploys wait for this to know their new revision is serving.
    deployment: process.env.CODEV_DEPLOYMENT_ID ?? null,
    components: { database, realtime },
  };
}
