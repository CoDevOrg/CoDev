import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "./database";
import { listGitHubInstallations } from "./github";
import { getHostState } from "./host";
import { getReadiness } from "./readiness";

export function scaleToZeroStatus(activeWorkspaces: number, hostState: string) {
  if (activeWorkspaces > 0) return "in-use" as const;
  if (hostState === "stopped" || hostState === "stopping") {
    return "safe" as const;
  }
  return "attention" as const;
}

export async function getLaunchPreflight(userId: string) {
  const [readiness, installations, hostState, activeWorkspaces] =
    await Promise.all([
      getReadiness(),
      listGitHubInstallations(userId),
      getHostState(),
      getDatabase()
        .select({ id: schema.workspaces.id })
        .from(schema.workspaces)
        .innerJoin(
          schema.workspaceMembers,
          and(
            eq(schema.workspaceMembers.workspaceId, schema.workspaces.id),
            eq(schema.workspaceMembers.userId, userId),
          ),
        )
        .where(
          inArray(schema.workspaces.status, [
            "provisioning",
            "ready",
            "stopping",
          ]),
        ),
    ]);
  const scaleToZero = scaleToZeroStatus(activeWorkspaces.length, hostState);
  const checks = {
    website: readiness.status === "ready" ? "pass" : "fail",
    database:
      readiness.components.database.status === "ready" ? "pass" : "fail",
    realtime:
      readiness.components.realtime.status === "ready" ? "pass" : "fail",
    orchestrator:
      readiness.components.orchestrator.status === "degraded" ? "fail" : "pass",
    github: installations.length > 0 ? "pass" : "fail",
    scaleToZero: scaleToZero === "attention" ? "attention" : ("pass" as const),
  };
  const ready = Object.values(checks).every((status) => status === "pass");
  return {
    status: ready ? ("ready" as const) : ("attention" as const),
    release: readiness.release,
    checks,
    github: { installationCount: installations.length },
    runtime: {
      hostState,
      activeWorkspaces: activeWorkspaces.length,
      scaleToZero,
    },
    recovery:
      scaleToZero === "attention"
        ? "Run lifecycle reconciliation and stop the Firecracker host."
        : null,
  };
}
