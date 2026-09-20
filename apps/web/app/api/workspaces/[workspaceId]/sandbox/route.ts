import { apiError } from "@/lib/http/api";
import { ApiError, withWorkspace } from "@/lib/http/api-route";
import {
  clearWorkspaceSnapshot,
  E2B_LIFECYCLE_OPTIONS,
  getWorkspaceSnapshot,
} from "@/lib/runtime/hibernation";
import { getRepositorySnapshot } from "@/lib/github/github";
import {
  getHostState,
  getHostStateFor,
  requestHostWake,
  requestHostWakeFor,
} from "@/lib/runtime/host";
import {
  getSandbox,
  OrchestratorError,
  provisionSandbox,
  waitForOrchestrator,
  waitForOrchestratorAt,
} from "@/lib/runtime/orchestrator";
import {
  ensureRuntimeHostAssignment,
  isRuntimeHostPoolEnabled,
} from "@/lib/runtime/runtime-host-pool";
import { isWorkspacePersistentStorageEnabled } from "@/lib/runtime/workspace-storage";
import {
  assertWorkspaceCreditQuota,
  QuotaError,
  quotaResponse,
} from "@/lib/runtime/quotas";
import {
  beginWorkspaceProvisioning,
  getWorkspaceForMember,
  getWorkspaceRuntime,
  markWorkspaceFailed,
  markWorkspaceReady,
  markWorkspaceStopped,
  WorkspaceLifecycleError,
} from "@/lib/workspaces/workspaces";

export const maxDuration = 60;

export const GET = withWorkspace(
  "view",
  async ({ user, workspaceId }) => {
    const workspace = await getWorkspaceForMember(workspaceId, user.id);
    if (!workspace) throw new ApiError("Workspace not found.", 404);
    const runtime = await getWorkspaceRuntime(workspaceId);
    if (runtime?.status !== "ready") {
      return Response.json({ runtime });
    }
    const runtimeHost = isRuntimeHostPoolEnabled()
      ? await ensureRuntimeHostAssignment(workspaceId, { ensureStorage: true })
      : null;
    if (isRuntimeHostPoolEnabled() && !runtimeHost) {
      return Response.json({ state: "starting" }, { status: 202 });
    }
    const hostState = runtimeHost
      ? await getHostStateFor(runtimeHost.providerId)
      : await getHostState();
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
  },
  { errorStatus: 502 },
);

export const POST = withWorkspace(
  "view",
  async ({ user, workspaceId, access }) => {
    if (!access.permissions.coSteer && !access.permissions.review) {
      throw new ApiError(
        "Only workspace editors or reviewers can start the workspace runtime.",
        403,
      );
    }
    const resumePermission = access.permissions.coSteer ? "coSteer" : "review";
    const workspace = await getWorkspaceForMember(workspaceId, user.id);
    if (!workspace) return apiError(new Error("Workspace not found."), 404);
    if (!workspace.repository || !workspace.baseSha) {
      return apiError(
        new Error("Connect a GitHub repository before this workspace can run."),
        409,
      );
    }
    try {
      const runtime = await getWorkspaceRuntime(workspaceId);
      if (runtime?.status === "ready") {
        return Response.json({ runtime });
      }
      if (
        runtime?.status === "provisioning" ||
        runtime?.status === "stopping"
      ) {
        return Response.json({ state: runtime.status }, { status: 202 });
      }
      await assertWorkspaceCreditQuota(workspaceId, user.id);
      const runtimeHost = isRuntimeHostPoolEnabled()
        ? await ensureRuntimeHostAssignment(workspaceId, {
            ensureStorage: true,
          })
        : null;
      if (isRuntimeHostPoolEnabled() && !runtimeHost) {
        return Response.json({ state: "starting" }, { status: 202 });
      }
      const hostState = runtimeHost
        ? await requestHostWakeFor(runtimeHost.providerId)
        : await requestHostWake();
      if (hostState === "starting") {
        return Response.json({ state: "starting" }, { status: 202 });
      }
      const expiresAt = await beginWorkspaceProvisioning(
        workspaceId,
        user.id,
        resumePermission,
      );
      if (runtimeHost) {
        await waitForOrchestratorAt(runtimeHost.runtimeAddress);
      } else {
        await waitForOrchestrator();
      }
      const persistedSnapshot = await getWorkspaceSnapshot(workspaceId);
      const persistentStorage =
        isWorkspacePersistentStorageEnabled() && runtimeHost?.diskLun != null;
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
        resumeFromSnapshot: Boolean(persistedSnapshot) && !persistentStorage,
        ...(persistentStorage
          ? { persistentDiskLun: runtimeHost.diskLun! }
          : {}),
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
  },
);
