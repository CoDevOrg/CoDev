import "server-only";

import { getGitHubUserToken } from "./github";
import { getHostState, requestHostWake } from "./host";
import {
  orcaPersonalPath,
  orcaWorkspacePath,
  parseOrcaReady,
  type OrcaPairing,
} from "./orca-pairing";
import {
  OrchestratorError,
  startIde,
  waitForOrchestrator,
} from "./orchestrator";

/**
 * Control-plane client for the per-workspace Orca IDE backend. All host
 * interaction goes through the IAM-authenticated `codev-orchestrator` API
 * (SigV4, same as the Firecracker sandbox routes) — SSM RunCommand is not
 * used for Orca at all, so Vercel never needs host shell access for it. The
 * browser only ever receives the pairing offer and connects directly to the
 * TLS WebSocket endpoint the orchestrator's own Caddy instance advertises.
 */

export class OrcaHostError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "OrcaHostError";
  }
}

export type OrcaRuntimeState =
  | { state: "host-starting" }
  | { state: "ready"; pairing: OrcaPairing; workspacePath: string };

/**
 * Ensure the EC2 host is running, the orchestrator is reachable, and this
 * workspace has its own dedicated Orca IDE process (cloning its repository
 * first if needed). Returns `host-starting` while the instance boots so the
 * client can poll.
 */
export async function ensureOrcaSession(
  workspace: {
    id: string;
    repository: string | null;
    repositoryVisibility: string | null;
    defaultBranch: string | null;
  },
  userId: string,
): Promise<OrcaRuntimeState> {
  const hostState = await getHostState();
  if (hostState !== "running") {
    const wake = await requestHostWake();
    if (wake !== "running") {
      return { state: "host-starting" };
    }
  }
  await waitForOrchestrator();

  const workspacePath = orcaWorkspacePath(workspace.id);
  const token =
    workspace.repositoryVisibility === "private"
      ? await getGitHubUserToken(userId)
      : undefined;
  const clone =
    workspace.repository && workspace.defaultBranch
      ? {
          repository: workspace.repository,
          defaultBranch: workspace.defaultBranch,
          ...(token ? { token } : {}),
        }
      : undefined;

  try {
    const session = await startIde(workspace.id, {
      projectRoot: workspacePath,
      ...(clone ? { clone } : {}),
    });
    const pairing = parseOrcaReady(session.ready, workspace.id);
    return { state: "ready", pairing, workspacePath };
  } catch (error) {
    if (error instanceof OrchestratorError) {
      throw new OrcaHostError(error.message, error.status);
    }
    throw error;
  }
}

/**
 * Ensure this member has their own Orca runtime for the personal settings
 * surface. It is keyed by the member's own id rather than a workspace and
 * never clones a repository, so the same Orca client can render personal
 * settings without opening (or inventing) a workspace.
 */
export async function ensurePersonalOrcaSession(
  userId: string,
): Promise<OrcaRuntimeState> {
  const hostState = await getHostState();
  if (hostState !== "running") {
    const wake = await requestHostWake();
    if (wake !== "running") {
      return { state: "host-starting" };
    }
  }
  await waitForOrchestrator();

  const workspacePath = orcaPersonalPath(userId);
  try {
    const session = await startIde(userId, { projectRoot: workspacePath });
    const pairing = parseOrcaReady(session.ready, userId);
    return { state: "ready", pairing, workspacePath };
  } catch (error) {
    if (error instanceof OrchestratorError) {
      throw new OrcaHostError(error.message, error.status);
    }
    throw error;
  }
}
