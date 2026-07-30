import { apiError, getApiUser } from "@/lib/api";
import { getRepositorySnapshot } from "@/lib/github";
import { getHostState, requestHostWake } from "@/lib/host";
import {
  destroySandbox,
  getSandbox,
  OrchestratorError,
  provisionSandbox,
  waitForOrchestrator,
} from "@/lib/orchestrator";
import {
  beginWorkspaceProvisioning,
  beginWorkspaceStop,
  getWorkspaceForMember,
  getWorkspaceRuntime,
  markWorkspaceFailed,
  markWorkspaceReady,
  markWorkspaceStopped,
  WorkspaceLifecycleError,
} from "@/lib/workspaces";

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
  if (workspace.role !== "owner") {
    return apiError(
      new Error("Only the workspace owner can provision a sandbox."),
      403,
    );
  }

  try {
    const hostState = await requestHostWake();
    if (hostState === "starting") {
      return Response.json({ state: "starting" }, { status: 202 });
    }
    const expiresAt = await beginWorkspaceProvisioning(workspaceId, user.id);
    await waitForOrchestrator();
    const repositorySnapshot =
      workspace.repositoryVisibility === "private"
        ? await getRepositorySnapshot(
            user.id,
            workspace.repository,
            workspace.baseSha,
          )
        : undefined;
    const sandbox = await provisionSandbox({
      workspaceId,
      repositoryUrl:
        workspace.repositoryVisibility === "public"
          ? `https://github.com/${workspace.repository}.git`
          : null,
      ...(repositorySnapshot ? { repositorySnapshot } : {}),
      baseSha: workspace.baseSha,
      expiresAt: expiresAt.toISOString(),
    });
    await markWorkspaceReady(workspaceId, sandbox.id, sandbox.headSha);
    return Response.json({ sandbox }, { status: 201 });
  } catch (error) {
    await markWorkspaceFailed(workspaceId, error).catch(() => undefined);
    return apiError(
      error,
      error instanceof WorkspaceLifecycleError ? error.status : 502,
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  const { workspaceId } = await params;
  const workspace = await getWorkspaceForMember(workspaceId, user.id);
  if (!workspace) return apiError(new Error("Workspace not found."), 404);
  if (workspace.role !== "owner") {
    return apiError(
      new Error("Only the workspace owner can stop a sandbox."),
      403,
    );
  }

  try {
    await beginWorkspaceStop(workspaceId, user.id);
    await destroySandbox(workspaceId);
    await markWorkspaceStopped(workspaceId);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof WorkspaceLifecycleError) {
      return apiError(error, error.status);
    }
    await markWorkspaceFailed(workspaceId, error).catch(() => undefined);
    return apiError(error, 502);
  }
}
