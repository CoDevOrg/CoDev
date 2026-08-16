import "server-only";

import {
  clearWorkspaceSnapshot,
  E2B_LIFECYCLE_OPTIONS,
  getWorkspaceSnapshot,
} from "./hibernation";
import { getRepositorySnapshot, type RepositorySnapshot } from "./github";
import { getHostState, requestHostWake } from "./host";
import { recordWorkspaceHeartbeat } from "./heartbeat";
import { requireWorkspacePermission } from "./access";
import {
  createSandboxWorktree,
  getSandbox,
  injectHostedCodexRuntimeGrant,
  OrchestratorError,
  provisionSandbox,
  waitForOrchestrator,
} from "./orchestrator";
import { deliverHostedCodexRuntimeGrant } from "./hosted-codex-runtime-delivery";
import { assertVmMinuteQuota } from "./quotas";
import {
  beginWorkspaceProvisioning,
  getWorkspaceForMember,
  getWorkspaceRuntime,
  listActiveAgentWorktrees,
  markWorkspaceFailed,
  markWorkspaceReady,
  markWorkspaceStopped,
  WorkspaceLifecycleError,
} from "./workspaces";

const EMPTY_COMMIT_SHA = "0".repeat(40);
const COMMIT_SHA = /^[0-9a-f]{40}$/;

function folderRepositorySnapshot(): RepositorySnapshot {
  const readme = "CoDev folder workspace\n";
  const binary = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02,
  ]);
  const files = [
    {
      path: "README.md",
      mode: "100644" as const,
      contentBase64: Buffer.from(readme).toString("base64"),
    },
    {
      path: "assets/logo.png",
      mode: "100644" as const,
      contentBase64: binary.toString("base64"),
    },
  ];
  return {
    files,
    totalBytes: Buffer.byteLength(readme) + binary.length,
  };
}

async function materializeAgentWorktrees(workspaceId: string, headSha: string) {
  const worktrees = await listActiveAgentWorktrees(workspaceId);
  for (const worktree of worktrees) {
    try {
      await createSandboxWorktree(workspaceId, worktree.id, headSha);
    } catch (error) {
      if (error instanceof OrchestratorError && error.status === 409) {
        continue;
      }
      throw error;
    }
  }
}

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
  const githubConnected = Boolean(workspace.repository && workspace.baseSha);
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
      : githubConnected && workspace.repositoryVisibility === "private"
        ? await getRepositorySnapshot(
            userId,
            workspace.repository,
            workspace.baseSha,
          )
        : githubConnected
          ? undefined
          : folderRepositorySnapshot();
    const sandbox = await provisionSandbox({
      workspaceId,
      repositoryUrl: repositorySnapshot
        ? null
        : `https://github.com/${workspace.repository}.git`,
      ...(repositorySnapshot ? { repositorySnapshot } : {}),
      baseSha: COMMIT_SHA.test(workspace.baseSha)
        ? workspace.baseSha
        : githubConnected
          ? workspace.baseSha
          : EMPTY_COMMIT_SHA,
      expiresAt: expiresAt.toISOString(),
      resumeFromSnapshot: Boolean(persistedSnapshot),
      lifecycle: E2B_LIFECYCLE_OPTIONS,
    });
    await deliverHostedCodexRuntimeGrant({
      userId,
      workspaceId,
      inject: (grant) => injectHostedCodexRuntimeGrant(workspaceId, grant),
    });
    await markWorkspaceReady(workspaceId, sandbox.id, sandbox.headSha);
    if (persistedSnapshot) await clearWorkspaceSnapshot(workspaceId);
    if (!githubConnected) {
      await materializeAgentWorktrees(workspaceId, sandbox.headSha);
    }
    return sandbox;
  } catch (error) {
    await markWorkspaceFailed(workspaceId, error).catch(() => undefined);
    throw error;
  }
}
