import "server-only";

import type { Gen2PreviewPortsResponse } from "@codev/contracts";

import { fakeGuestEnabled } from "../runtime/fake-guest";
import { OrchestratorError } from "../runtime/orchestrator-request";
import { runtimeTargetFromRow } from "../runtime/workspace-runtime-target";
import { gen2PreviewAccess } from "./preview-access";
import {
  isGen2PreviewDevDirect,
  readGen2PreviewConfig,
} from "./preview-config";
import {
  isGen2PreviewBootEnabled,
  isGen2PreviewGuestBusy,
  readGen2PreviewSockets,
} from "./preview-guest";

type Reason = NonNullable<Gen2PreviewPortsResponse["reason"]>;

const unavailable = (reason: Reason): Gen2PreviewPortsResponse => ({
  available: false,
  reason,
  ports: [],
});

/** Local development previews the developer's own machine. */
async function devPorts(workspaceId: string) {
  const ports = fakeGuestEnabled()
    ? (await readGen2PreviewSockets(workspaceId, null)).ports
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
  if (!isGen2PreviewBootEnabled()) return unavailable("image_update");
  try {
    const target = await runtimeTargetFromRow(workspaceId, access);
    const { proxy, ports } = await readGen2PreviewSockets(workspaceId, target);
    if (!proxy) return unavailable("image_update");
    return { available: true, reason: null, ports };
  } catch (error) {
    if (isGen2PreviewGuestBusy(error)) return unavailable("busy");
    if (error instanceof OrchestratorError && error.status === 409)
      return unavailable("not_ready");
    throw error;
  }
}
