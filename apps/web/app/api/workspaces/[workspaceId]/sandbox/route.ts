import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import {
  clearWorkspaceSnapshot,
  E2B_LIFECYCLE_OPTIONS,
  getWorkspaceSnapshot,
} from "@/lib/hibernation";
import { getRepositorySnapshot } from "@/lib/github";
import { getHostState, requestHostWake } from "@/lib/host";
import {
  getSandbox,
  OrchestratorError,
  provisionSandbox,
  waitForOrchestrator,
} from "@/lib/orchestrator";
import { assertVmMinuteQuota, QuotaError, quotaResponse } from "@/lib/quotas";
import {
  beginWorkspaceProvisioning,
  getWorkspaceForMember,
  getWorkspaceRuntime,
  markWorkspaceFailed,
  markWorkspaceReady,
  markWorkspaceStopped,
  WorkspaceLifecycleError,
} from "@/lib/workspaces";

export const maxDuration = 60;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  const { workspaceId } = await params;
  const workspace = await getWorkspaceForMember(workspaceId, user.id);
  if (!workspace) return apiError(new Error("Workspace not found."), 404);

  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
    const runtime = await getWorkspaceRuntime(workspaceId);
    if (runtime?.status !== "ready") {
      return Response.json({ runtime });
    }
    const hostState = await getHostState();
    if (hostState !== "running") {
      await markWorkspaceStopped(workspaceId);
      return Response.json({
        runtime: { ...runtime, status: "stopped", sandboxId: null },
      });
    }
    try {
      const sandbox = await getSandbox(workspaceId);
      return Response.json({ runtime, sandbox });
    } catch (error) {
      if (error instanceof OrchestratorError && error.status === 404) {
        await markWorkspaceStopped(workspaceId);
        return Response.json({
          runtime: { ...runtime, status: "stopped", sandboxId: null },
        });
      }
      throw error;
    }
  } catch (error) {
    return apiError(error, 502);
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  const { workspaceId } = await params;
  const workspace = await getWorkspaceForMember(workspaceId, user.id);
  if (!workspace) return apiError(new Error("Workspace not found."), 404);
  if (!workspace.repository || !workspace.baseSha) {
    return apiError(
      new Error("Connect a GitHub repository before this workspace can run."),
      409,
    );
  }
  let resumePermission: "coSteer" | "review";
  try {
    const access = await requireWorkspacePermission(
      workspaceId,
      user.id,
      "view",
    );
    if (!access.permissions.coSteer && !access.permissions.review) {
      return apiError(
        new Error(
          "Only workspace editors or reviewers can start the workspace runtime.",
        ),
        403,
      );
    }
    resumePermission = access.permissions.coSteer ? "coSteer" : "review";
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 403,
    );
  }

  try {
    const runtime = await getWorkspaceRuntime(workspaceId);
    if (runtime?.status === "ready") {
      return Response.json({ runtime });
    }
    if (runtime?.status === "provisioning" || runtime?.status === "stopping") {
      return Response.json({ state: runtime.status }, { status: 202 });
    }
    await assertVmMinuteQuota(workspace.ownerId);
    const hostState = await requestHostWake();
    if (hostState === "starting") {
      return Response.json({ state: "starting" }, { status: 202 });
    }
    const expiresAt = await beginWorkspaceProvisioning(
      workspaceId,
      user.id,
      resumePermission,
    );
    await waitForOrchestrator();
    const persistedSnapshot = await getWorkspaceSnapshot(workspaceId);
    const repositorySnapshot = persistedSnapshot?.snapshot
      ? persistedSnapshot.snapshot
      : workspace.repositoryVisibility === "private"
        ? await getRepositorySnapshot(
            user.id,
            workspace.repository,
            workspace.baseSha,
          )
        : undefined;
    const sandbox = await provisionSandbox({
      workspaceId,
      repositoryUrl: repositorySnapshot
        ? null
        : `https://github.com/${workspace.repository}.git`,
      ...(repositorySnapshot ? { repositorySnapshot } : {}),
      baseSha: workspace.baseSha,
      expiresAt: expiresAt.toISOString(),
      resumeFromSnapshot: Boolean(persistedSnapshot),
      lifecycle: E2B_LIFECYCLE_OPTIONS,
    });
    await markWorkspaceReady(workspaceId, sandbox.id, sandbox.headSha);
    if (persistedSnapshot) await clearWorkspaceSnapshot(workspaceId);
    return Response.json({ sandbox }, { status: 201 });
  } catch (error) {
    if (error instanceof QuotaError) return quotaResponse(error);
    await markWorkspaceFailed(workspaceId, error).catch(() => undefined);
    return apiError(
      error,
      error instanceof WorkspaceLifecycleError ? error.status : 502,
    );
  }
}
