import "server-only";

import { mintWorkspaceCoordinationToken } from "./cli-agent-session";
import { openOrcaInterval } from "./compute-credits";
import { getPublicAppOrigin } from "./password-reset";
import { resolveAgentCredential, resolveCursorCliAuth } from "./credentials";
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
  touchIde,
  waitForOrchestrator,
  type IdeSession,
  type StartIdeInput,
} from "./orchestrator";
import { assertWorkspaceCreditQuota, QuotaError } from "./quotas";

const STALE_IDE_PROCESS_MESSAGE =
  "Orca IDE process exited before reporting readiness";

/**
 * Orchestrator responses that mean "ask again shortly" rather than "this
 * failed": the host is mid-restart (502/503/504), a call timed out while it
 * booted (408), it hit an internal blip (500), or every IDE slot is taken
 * (409) until the idle reaper frees one.
 */
const TRANSIENT_ORCHESTRATOR_STATUSES = new Set([408, 409, 500, 502, 503, 504]);

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
 * A linked hosted Codex subscription is otherwise only ever materialized
 * inside the Firecracker guest for CoDev's own backend-driven exec turns
 * (see start_codex_exec in services/orchestrator/src/guest.rs) — the Codex
 * CLI Orca launches interactively on the host has never had any credential
 * written for it, so it always prompted a separate sign-in even for a user
 * with an account already linked. Best-effort: a resolution failure (no
 * link, obsolete format, subscription disabled) just means the IDE's Codex
 * CLI falls back to prompting sign-in itself, same as before this existed —
 * it must never block the IDE from starting.
 */
async function resolveCodexAuthCacheForIde(
  userId: string,
  workspaceId: string,
): Promise<string | undefined> {
  try {
    const credential = await resolveAgentCredential(
      userId,
      workspaceId,
      "openai",
    );
    return credential.authType === "HOSTED_CODEX_SUBSCRIPTION"
      ? credential.codexAuthCacheJson
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The Cursor CLI (`cursor-agent`) the IDE launches interactively has never
 * had a credential written for it, so it always stranded on its own sign-in
 * prompt. Two ways to authenticate it, in order of preference:
 *
 *  - `cursorAuthJson`: the `{accessToken, refreshToken}` pair from Cursor's
 *    browser login (Settings → "Connect Cursor"), formatted as the CLI's own
 *    `~/.config/cursor/auth.json`. The orchestrator files it per member and
 *    points `XDG_CONFIG_HOME` at it; `cursor-agent` then refreshes its own
 *    tokens from that copy.
 *  - `cursorApiKey`: a pasted `key_…` API key, handed through as
 *    `CURSOR_API_KEY`.
 *
 * Best-effort throughout: nothing linked just means the CLI prompts sign-in
 * itself, exactly as before, and never blocks the IDE from starting.
 */
async function resolveCursorAuthJsonForIde(
  userId: string,
  workspaceId: string,
): Promise<string | undefined> {
  try {
    const auth = await resolveCursorCliAuth(userId, workspaceId);
    if (!auth) return undefined;
    return JSON.stringify({
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
      apiKey: null,
      bedrockCredentials: null,
    });
  } catch {
    return undefined;
  }
}

async function resolveCursorApiKeyForIde(
  userId: string,
  workspaceId: string,
): Promise<string | undefined> {
  try {
    const credential = await resolveAgentCredential(
      userId,
      workspaceId,
      "cursor",
    );
    return credential.authType === "API_KEY"
      ? credential.apiKeyOrToken?.trim() || undefined
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The API-key fallback for the interactive Codex CLI: when a member linked a
 * plain OpenAI key rather than a hosted Codex subscription,
 * resolveCodexAuthCacheForIde returns nothing and the CLI stranded on
 * sign-in. Hand the key through as OPENAI_API_KEY. A hosted subscription,
 * when present, is materialized as CODEX_HOME instead and takes precedence.
 */
async function resolveOpenAiApiKeyForIde(
  userId: string,
  workspaceId: string,
): Promise<string | undefined> {
  try {
    const credential = await resolveAgentCredential(
      userId,
      workspaceId,
      "openai",
    );
    return credential.authType === "API_KEY"
      ? credential.apiKeyOrToken?.trim() || undefined
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Same idea as resolveCodexAuthCacheForIde, for a linked Anthropic
 * credential. Both the BYOK API key and the OAuth token from `claude
 * setup-token`/browser login resolve through the same generic lookup,
 * distinguished only by authType — the Claude Code CLI expects a different
 * env var for each (ANTHROPIC_API_KEY vs CLAUDE_CODE_OAUTH_TOKEN), so the
 * orchestrator needs to know which one it's setting.
 */
async function resolveClaudeEnvForIde(
  userId: string,
  workspaceId: string,
): Promise<
  { anthropicApiKey: string } | { claudeCodeOauthToken: string } | undefined
> {
  try {
    const credential = await resolveAgentCredential(
      userId,
      workspaceId,
      "anthropic",
    );
    if (!credential.apiKeyOrToken) return undefined;
    if (credential.authType === "API_KEY") {
      return { anthropicApiKey: credential.apiKeyOrToken };
    }
    if (credential.authType === "OAUTH_TOKEN") {
      return { claudeCodeOauthToken: credential.apiKeyOrToken };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Mark this workspace's IDE session as still in use, and report whether the
 * session is still there at all.
 *
 * `gone` specifically means the orchestrator has no session under this
 * workspace id — it was reaped for idleness, or the host was stopped or
 * replaced underneath an open tab. The iframe still pointing at it is dead,
 * so the client uses this to re-provision rather than sitting on a blank IDE.
 * Every other failure is transient (a host mid-restart, a dropped request)
 * and reports `unknown`: retrying the keepalive a minute later is the right
 * response, not tearing down a working session.
 */
export async function recordOrcaActivity(
  workspaceId: string,
): Promise<"alive" | "gone" | "unknown"> {
  try {
    await touchIde(workspaceId);
    return "alive";
  } catch (error) {
    if (error instanceof OrchestratorError && error.status === 404) {
      return "gone";
    }
    return "unknown";
  }
}

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
  try {
    await assertWorkspaceCreditQuota(workspace.id);
  } catch (error) {
    if (error instanceof QuotaError) {
      throw new OrcaHostError(error.message, 429);
    }
    throw error;
  }

  // Everything between here and a healthy orchestrator is infrastructure the
  // person opening the workspace can do nothing about: a stopped instance, a
  // capacity refusal, a host still booting its services. None of it is an
  // error from their point of view - it just means "not ready yet" - so any
  // failure reports `host-starting` and the client keeps polling.
  try {
    const hostState = await getHostState();
    if (hostState !== "running") {
      const wake = await requestHostWake();
      if (wake !== "running") {
        return { state: "host-starting" };
      }
    }
    await waitForOrchestrator();
  } catch {
    return { state: "host-starting" };
  }

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
  const [
    codexAuthCacheJson,
    cursorAuthJson,
    cursorApiKey,
    openaiApiKey,
    claudeEnv,
  ] = await Promise.all([
    resolveCodexAuthCacheForIde(userId, workspace.id),
    resolveCursorAuthJsonForIde(userId, workspace.id),
    resolveCursorApiKeyForIde(userId, workspace.id),
    resolveOpenAiApiKeyForIde(userId, workspace.id),
    resolveClaudeEnvForIde(userId, workspace.id),
  ]);

  const coordinationMcpUrl = new URL(
    `/api/workspaces/${workspace.id}/mcp/coordination`,
    getPublicAppOrigin(),
  ).toString();

  try {
    const session = await startIdeRecoveringStaleProcess(workspace.id, {
      projectRoot: workspacePath,
      memberId: userId,
      coordinationMcpUrl,
      coordinationMcpToken: mintWorkspaceCoordinationToken(workspace.id),
      ...(clone ? { clone } : {}),
      ...(codexAuthCacheJson ? { codexAuthCacheJson } : {}),
      ...(cursorAuthJson ? { cursorAuthJson } : {}),
      ...(cursorApiKey ? { cursorApiKey } : {}),
      ...(openaiApiKey ? { openaiApiKey } : {}),
      ...claudeEnv,
    });
    const pairing = parseOrcaReady(session.ready, workspace.id);
    // Best-effort: a metering hiccup must never block the IDE from opening.
    await openOrcaInterval(userId, workspace.id).catch(() => {});
    return { state: "ready", pairing, workspacePath };
  } catch (error) {
    if (error instanceof OrchestratorError) {
      // The host can stop, be replaced, or still be bringing its services up
      // between the health check above and this call, and a full IDE slot
      // frees itself once the idle reaper runs. All of those resolve on their
      // own, so poll rather than telling somebody their workspace is broken.
      if (TRANSIENT_ORCHESTRATOR_STATUSES.has(error.status)) {
        return { state: "host-starting" };
      }
      throw new OrcaHostError(error.message, error.status);
    }
    throw error;
  }
}
