import "server-only";

import { getGitHubUserToken } from "./github";
import { getHostState, requestHostWake } from "./host";
import {
  orcaWorkspacePath,
  parseOrcaReady,
  type OrcaPairing,
} from "./orca-pairing";
import {
  OrchestratorError,
  startIde,
  stopIde,
  waitForOrchestrator,
  type IdeSession,
  type StartIdeInput,
} from "./orchestrator";

const STALE_IDE_PROCESS_MESSAGE =
  "Orca IDE process exited before reporting readiness";

/**
 * `startIde` is meant to idempotently return an already-running session, but
 * if a previous `orca serve` launch for this session id crashed on startup,
 * the orchestrator's record is left wedged: every later call fails with the
 * same error forever. Nothing else reclaims it — the lifecycle cron only
 * reconciles real workspace rows, and this session id may not be one (e.g.
 * the personal settings surface keys sessions by user id). Stop the stale
 * record once and retry so a single crashed launch doesn't lock a session
 * out permanently.
 */
async function startIdeRecoveringStaleProcess(
  sessionId: string,
  input: StartIdeInput,
): Promise<IdeSession> {
  try {
    return await startIde(sessionId, input);
  } catch (error) {
    if (
      !(error instanceof OrchestratorError) ||
      error.message !== STALE_IDE_PROCESS_MESSAGE
    ) {
      throw error;
    }
    await stopIde(sessionId).catch(() => {});
    return startIde(sessionId, input);
  }
}

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
    const session = await startIdeRecoveringStaleProcess(workspace.id, {
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
