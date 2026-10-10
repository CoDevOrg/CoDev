import "server-only";

import type { Gen2PreviewPortsResponse } from "@codev/contracts";

import { readArmWorkspaceConfig } from "../runtime/arm-workspace-config";
import { fakeGuestEnabled } from "../runtime/fake-guest";
import { executeInSandbox } from "../runtime/orchestrator-files";
import { OrchestratorError } from "../runtime/orchestrator-request";
import { runtimeTargetFromRow } from "../runtime/workspace-runtime-target";
import { gen2PreviewAccess } from "./preview-access";
import {
  isGen2PreviewDevDirect,
  readGen2PreviewConfig,
} from "./preview-config";
import { readGen2PreviewPorts } from "./workspace-ports-parse";

type Reason = NonNullable<Gen2PreviewPortsResponse["reason"]>;

const unavailable = (reason: Reason): Gen2PreviewPortsResponse => ({
  available: false,
  reason,
  ports: [],
});

/** Only baked images carry the preview proxy; legacy boots never will. */
function bakedBoot() {
  try {
    return readArmWorkspaceConfig().bootEnabled;
  } catch {
    return false;
  }
}

/** A guest exec waits behind a native agent turn; give up rather than queue. */
function busy(error: unknown) {
  if (error instanceof OrchestratorError)
    return [408, 504, 524].includes(error.status);
  return error instanceof Error && /timed out/i.test(error.message);
}

/** Reads the guest's listening sockets without counting as member activity. */
async function readSockets(
  workspaceId: string,
  target: Awaited<ReturnType<typeof runtimeTargetFromRow>>,
) {
  const { output } = await executeInSandbox(
    workspaceId,
    { command: ["cat", "/proc/net/tcp", "/proc/net/tcp6"], timeoutSeconds: 8 },
    { recordActivity: false, timeoutMs: 10_000, target },
  );
  return readGen2PreviewPorts(output);
}

/** Local development previews the developer's own machine. */
async function devPorts(workspaceId: string) {
  const ports = fakeGuestEnabled()
    ? (await readSockets(workspaceId, null)).ports
    : [];
  return { available: true, reason: null, ports };
}

/**
 * The dev servers an editor can preview in this workspace. Unconfigured
 * deployments and legacy guests answer without touching the guest; a guest
 * busy with a native agent turn answers `busy` instead of waiting.
 */
export async function listGen2WorkspacePorts(
  workspaceId: string,
  userId: string,
): Promise<Gen2PreviewPortsResponse> {
  const access = await gen2PreviewAccess(workspaceId, userId);
  if (isGen2PreviewDevDirect()) return devPorts(workspaceId);
  if (!readGen2PreviewConfig()) return unavailable("not_configured");
  if (access.provider !== "azure_arm") return unavailable("image_update");
  if (access.status !== "ready" || !access.host)
    return unavailable("not_ready");
  if (!bakedBoot()) return unavailable("image_update");
  try {
    const target = await runtimeTargetFromRow(workspaceId, access);
    const { proxy, ports } = await readSockets(workspaceId, target);
    if (!proxy) return unavailable("image_update");
    return { available: true, reason: null, ports };
  } catch (error) {
    if (busy(error)) return unavailable("busy");
    if (error instanceof OrchestratorError && error.status === 409)
      return unavailable("not_ready");
    throw error;
  }
}
