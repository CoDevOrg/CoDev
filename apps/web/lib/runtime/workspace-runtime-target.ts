import "server-only";

import { schema } from "@codev/db";
import { eq } from "drizzle-orm";

import { getDatabase } from "../platform/database";
import { OrchestratorError } from "./orchestrator-error";

/** Resolve on every call: a socket must not retain a stopped guest's generation. */
export async function workspaceRuntimeTarget(workspaceId: string) {
  const [row] = await getDatabase()
    .select({
      provider: schema.gen2Workspaces.runtimeProvider,
      status: schema.gen2Workspaces.runtimeStatus,
      generation: schema.gen2Workspaces.runtimeGeneration,
      host: schema.gen2Workspaces.runtimeRouteHost,
    })
    .from(schema.gen2Workspaces)
    .where(eq(schema.gen2Workspaces.id, workspaceId))
    .limit(1);
  if (!row) throw new OrchestratorError("Workspace not found.", 404);
  if (row.provider !== "azure_arm") return null;
  if (row.status !== "ready" || !row.host) {
    throw new OrchestratorError("The ARM workspace is not running.", 409);
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(workspaceId),
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (
    row.host !== `codev-${hash.slice(0, 20)}-g${row.generation}.trycodev.com`
  ) {
    throw new OrchestratorError("The ARM workspace route is invalid.", 503);
  }
  return { workspaceId, generation: row.generation, host: row.host };
}
