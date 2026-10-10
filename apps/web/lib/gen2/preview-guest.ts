import "server-only";

import { readArmWorkspaceConfig } from "../runtime/arm-workspace-config";
import { executeInSandbox } from "../runtime/orchestrator-files";
import { OrchestratorError } from "../runtime/orchestrator-request";
import type { WorkspaceRuntimeTarget } from "../runtime/workspace-runtime-target";
import { readGen2PreviewPorts } from "./workspace-ports-parse";

/** Only baked images carry the preview proxy; legacy boots never will. */
export function isGen2PreviewBootEnabled() {
  try {
    return readArmWorkspaceConfig().bootEnabled;
  } catch {
    return false;
  }
}

/**
 * A guest exec waits behind a native agent turn, and an edge error page (a
 * Cloudflare timeout) is not JSON. Either way the guest could not answer.
 */
export function isGen2PreviewGuestBusy(error: unknown) {
  if (error instanceof OrchestratorError)
    return [408, 504, 524].includes(error.status);
  if (error instanceof SyntaxError) return true;
  return error instanceof Error && /timed out/i.test(error.message);
}

/**
 * Reads the guest's listening sockets without counting as member activity:
 * whether the preview proxy owns its port, and the dev servers it forwards.
 */
export async function readGen2PreviewSockets(
  workspaceId: string,
  target: WorkspaceRuntimeTarget,
) {
  const { output } = await executeInSandbox(
    workspaceId,
    { command: ["cat", "/proc/net/tcp", "/proc/net/tcp6"], timeoutSeconds: 8 },
    { recordActivity: false, timeoutMs: 10_000, target },
  );
  return readGen2PreviewPorts(output);
}
