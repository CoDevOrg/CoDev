import { apiError, getApiUser } from "@/lib/api";
import { getHostState } from "@/lib/host";
import {
  destroySandbox,
  getSandbox,
  OrchestratorError,
  provisionSandbox,
  wakeOrchestrator,
} from "@/lib/orchestrator";
import {
  beginWorkspaceProvisioning,
  beginWorkspaceStop,
  getWorkspaceForMember,
  getWorkspaceRuntime,
  markWorkspaceFailed,
  markWorkspaceReady,
  markWorkspaceStopped,
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
    const expiresAt = await beginWorkspaceProvisioning(workspaceId, user.id);
    await wakeOrchestrator();
    const sandbox = await provisionSandbox({
      workspaceId,
      repositoryUrl: `https://github.com/${workspace.repository}.git`,
      baseSha: workspace.baseSha,
      expiresAt: expiresAt.toISOString(),
    });
    await markWorkspaceReady(workspaceId, sandbox.id);
    return Response.json({ sandbox }, { status: 201 });
  } catch (error) {
    await markWorkspaceFailed(workspaceId, error).catch(() => undefined);
    return apiError(error, 502);
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
    await markWorkspaceFailed(workspaceId, error).catch(() => undefined);
    return apiError(error, 502);
  }
}
