import { apiError, getApiUserAnyAuth } from "@/lib/api";
import { WorkspaceAccessError, requireWorkspacePermission } from "@/lib/access";
import { OrcaHostError, ensureOrcaSession } from "@/lib/orca-host";
import { getWorkspaceForMember } from "@/lib/workspaces";

export const maxDuration = 300;

/**
 * Open this workspace's own dedicated Orca IDE process on the CoDev EC2
 * host, spawned and tracked by `codev-orchestrator`. Wakes the host if
 * needed, waits for the pairing offer, and makes sure the workspace
 * repository is cloned. Responds with the pairing code the vendored Orca
 * web client boots from.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUserAnyAuth(request);
  if (!user) {
    return apiError(new Error("Sign in to open this workspace."), 401);
  }
  const { workspaceId } = await params;

  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
    const workspace = await getWorkspaceForMember(workspaceId, user.id);
    if (!workspace) {
      return apiError(new Error("Workspace not found."), 404);
    }

    const runtime = await ensureOrcaSession(workspace, user.id);
    if (runtime.state === "host-starting") {
      return Response.json({ state: "host-starting" }, { status: 202 });
    }

    return Response.json({
      state: "ready",
      pairingCode: runtime.pairing.pairingCode,
      endpoint: runtime.pairing.endpoint,
      runtimeId: runtime.pairing.runtimeId,
      workspacePath: runtime.workspacePath,
      webClientPath: "/orca/web-index.html",
    });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return apiError(error, error.status);
    }
    if (error instanceof OrcaHostError) {
      return apiError(error, error.status);
    }
    return apiError(error, 500);
  }
}
