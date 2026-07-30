import "server-only";

import { checkRealtimeConnection } from "./collaboration-server";
import { checkDatabaseConnection } from "./database";
import { getHostState } from "./host";
import { checkOrchestratorConnection } from "./orchestrator";

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
  let orchestrator: {
    status: "ready" | "sleeping" | "starting" | "degraded";
    latencyMs: number;
  };
  const hostStartedAt = Date.now();
  try {
    const state = await getHostState();
    if (state === "stopped" || state === "stopping") {
      orchestrator = {
        status: "sleeping",
        latencyMs: Date.now() - hostStartedAt,
      };
    } else if (state === "pending") {
      orchestrator = {
        status: "starting",
        latencyMs: Date.now() - hostStartedAt,
      };
    } else if (state === "running") {
      const result = await measured(checkOrchestratorConnection);
      orchestrator = result;
    } else {
      orchestrator = {
        status: "degraded",
        latencyMs: Date.now() - hostStartedAt,
      };
    }
  } catch {
    orchestrator = {
      status: "degraded",
      latencyMs: Date.now() - hostStartedAt,
    };
  }
  const ready =
    database.status === "ready" &&
    realtime.status === "ready" &&
    orchestrator.status !== "degraded";
  return {
    status: ready ? ("ready" as const) : ("degraded" as const),
    service: "codev-web",
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? "development",
    components: { database, realtime, orchestrator },
  };
}
