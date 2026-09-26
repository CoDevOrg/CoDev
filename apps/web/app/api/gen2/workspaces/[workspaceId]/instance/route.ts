import { withUser } from "@/lib/http/api-route";
import { ensureGen2Instance, stopGen2Instance } from "@/lib/gen2/instance";
import { getGen2WorkspaceDetail } from "@/lib/gen2/workspaces";

/** Provisioning a Firecracker guest can outlast a normal request. */
export const maxDuration = 300;

type Params = { workspaceId: string };

/**
 * Idempotent: "make sure this workspace has a machine". Called when a member
 * opens the workspace, so there is no start button to forget to press.
 */
export const POST = withUser<Params>(
  async ({ user, params: { workspaceId } }) => {
    await ensureGen2Instance(workspaceId, user.id);
    return Response.json({
      workspace: await getGen2WorkspaceDetail(workspaceId, user.id),
    });
  },
  { errorStatus: 502 },
);

/**
 * Owner-only teardown. Not surfaced in the UI; automatic idle hibernation
 * preserves the writable disks and is handled by the orchestrator.
 */
export const DELETE = withUser<Params>(
  async ({ user, params: { workspaceId } }) => {
    await stopGen2Instance(workspaceId, user.id);
    return Response.json({
      workspace: await getGen2WorkspaceDetail(workspaceId, user.id),
    });
  },
  { errorStatus: 502 },
);
