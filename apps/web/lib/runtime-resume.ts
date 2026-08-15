import "server-only";

import {
  clearWorkspaceSnapshot,
  E2B_LIFECYCLE_OPTIONS,
  getWorkspaceSnapshot,
} from "./hibernation";
import { getRepositorySnapshot } from "./github";
import { getHostState, requestHostWake } from "./host";
import { recordWorkspaceHeartbeat } from "./heartbeat";
import { requireWorkspacePermission } from "./access";
import {
  getSandbox,
  OrchestratorError,
  provisionSandbox,
  waitForOrchestrator,
} from "./orchestrator";
import { assertVmMinuteQuota } from "./quotas";
import {
  beginWorkspaceProvisioning,
  getWorkspaceForMember,
  getWorkspaceRuntime,
  markWorkspaceFailed,
  markWorkspaceReady,
  markWorkspaceStopped,
  WorkspaceLifecycleError,
} from "./workspaces";

const HOST_START_TIMEOUT_MS = 4 * 60 * 1_000;

async function waitForHostAndOrchestrator() {
  const deadline = Date.now() + HOST_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = await requestHostWake();
    if (state === "running") {
      await waitForOrchestrator();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new WorkspaceLifecycleError(
    "The Firecracker host is still starting. Try the action again shortly.",
    503,
  );
}

/**
 * Make a hibernated workspace executable before a mutating action. Reads can
 * continue to use the PostgreSQL snapshot without waking the host.
 */
export async function ensureWorkspaceRuntimeReady(
  workspaceId: string,
  userId: string,
  permission: "coSteer" | "review" = "coSteer",
) {
  await requireWorkspacePermission(workspaceId, userId, permission);
  const runtime = await getWorkspaceRuntime(workspaceId);
  try {
    await getSandbox(workspaceId);
    await recordWorkspaceHeartbeat(workspaceId);
    return;
  } catch (error) {
    if (
      !(
        error instanceof OrchestratorError &&
        (error.status === 404 || error.status === 403 || error.status === 503)
      )
    ) {
      throw error;
    }
    if (runtime?.status === "ready") {
      // The host may have stopped, restarted, or been replaced while the database
      // still says the runtime is ready. Wake host if stopped and treat missing runtime as stopped.
      await Promise.resolve(requestHostWake()).catch(() => undefined);
      await markWorkspaceStopped(workspaceId);
    }
  }

  const workspace = await getWorkspaceForMember(workspaceId, userId);
  if (!workspace) {
    throw new WorkspaceLifecycleError("Workspace not found.", 404);
  }
  if (!workspace.repository || !workspace.baseSha) {
    throw new WorkspaceLifecycleError(
      "Connect a GitHub repository before using the sandbox.",
    );
  }
  await assertVmMinuteQuota(workspace.ownerId);
  const expiresAt = await beginWorkspaceProvisioning(
    workspaceId,
    userId,
    permission,
  );

  try {
    if ((await getHostState()) !== "running") {
      await waitForHostAndOrchestrator();
    } else {
      await waitForOrchestrator();
    }
    const persistedSnapshot = await getWorkspaceSnapshot(workspaceId);
    const repositorySnapshot = persistedSnapshot?.snapshot
      ? persistedSnapshot.snapshot
      : workspace.repositoryVisibility === "private"
        ? await getRepositorySnapshot(
            userId,
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
    return sandbox;
  } catch (error) {
    await markWorkspaceFailed(workspaceId, error).catch(() => undefined);
    throw error;
  }
}
