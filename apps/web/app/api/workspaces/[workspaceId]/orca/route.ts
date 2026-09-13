import { apiError, getApiUserAnyAuth } from "@/lib/api";
import { logEvent, requestId } from "@/lib/observability";
import { WorkspaceAccessError, requireWorkspacePermission } from "@/lib/access";
import { OrcaHostError, ensureOrcaSession } from "@/lib/orca-host";
import { getWorkspaceForMember } from "@/lib/workspaces";
import { WorkspaceOpenTiming } from "@/lib/workspace-open-timing";

export const maxDuration = 300;

/**
 * Open this workspace's own dedicated Orca IDE process on the CoDev runtime
 * host, spawned and tracked by `codev-orchestrator`. Wakes the host if
 * needed, waits for the pairing offer, and makes sure the workspace
 * repository is cloned. Responds with the pairing code the vendored Orca
 * web client boots from.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const timing = new WorkspaceOpenTiming();
  const user = await timing.measure("authentication", () =>
    getApiUserAnyAuth(request),
  );
  if (!user) {
    return apiError(new Error("Sign in to open this workspace."), 401);
  }
  const { workspaceId } = await params;

  try {
    await timing.measure("authorization", () =>
      requireWorkspacePermission(workspaceId, user.id, "view"),
    );
    const workspace = await timing.measure("workspace", () =>
      getWorkspaceForMember(workspaceId, user.id),
    );
    if (!workspace) {
      return apiError(new Error("Workspace not found."), 404);
    }

    const runtime = await ensureOrcaSession(workspace, user.id, timing);
    if (runtime.state === "host-starting") {
      return Response.json(
        { state: "host-starting" },
        { status: 202, headers: timing.headers() },
      );
    }
    // Not a 202: polling cannot fix a runtime this environment has no way to
    // reach. 503 rather than 5xx-generic so an ops probe reads it correctly,
    // and `state` is what the client actually branches on.
    if (runtime.state === "unavailable") {
      logEvent("error", "workspace_runtime_unavailable", {
        workspaceId,
        detail: runtime.detail,
        requestId: requestId(request),
      });
      // The detail names environment variables and the cloud provider. That is
      // for whoever operates this deployment, not for whoever happened to open
      // the workspace, so it leaves the server only on a development build —
      // which is exactly where someone is debugging their own configuration.
      const exposeDetail = process.env.NODE_ENV !== "production";
      return Response.json(
        {
          state: "unavailable",
          error: exposeDetail ? runtime.detail : runtime.message,
        },
        { status: 503, headers: timing.headers() },
      );
    }

    return Response.json(
      {
        state: "ready",
        // The signed-in member, so the embedded IDE can tag each agent launch
        // with whose subscription it should run on. An id, never a credential —
        // the host resolves the secret itself (write_member_agent_credentials in
        // services/orchestrator/src/backend/orca.rs).
        memberId: user.id,
        pairingCode: runtime.pairing.pairingCode,
        endpoint: runtime.pairing.endpoint,
        runtimeId: runtime.pairing.runtimeId,
        workspacePath: runtime.workspacePath,
        webClientPath: "/orca/web-index.html",
      },
      { headers: timing.headers() },
    );
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return apiError(error, error.status);
    }
    if (error instanceof OrcaHostError) {
      if (error.detail !== error.message) {
        logEvent("error", "workspace_runtime_error", {
          workspaceId,
          status: error.status,
          detail: error.detail,
          requestId: requestId(request),
        });
      }
      // Same rule as the unavailable branch: the detail describes CoDev's
      // infrastructure, so it leaves the server only on a development build.
      return apiError(
        process.env.NODE_ENV !== "production"
          ? new OrcaHostError(error.detail, error.status)
          : error,
        error.status,
      );
    }
    return apiError(error, 500);
  }
}
