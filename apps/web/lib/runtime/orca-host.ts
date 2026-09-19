import "server-only";

import { mintWorkspaceCoordinationToken } from "../agents/cli-agent-session";
import { openOrcaInterval } from "./compute-credits";
import { getPublicAppOrigin } from "../auth/password-reset";
import {
  resolveClaudeCliTokenForIde,
  resolveCursorCliAuth,
  resolveWorkspaceApiKey,
} from "../providers/credentials";
import {
  decryptHostedMaterial,
  resolveHostedCodexSubscription,
} from "../providers/hosted-codex-subscription-credentials";
import { getGitHubUserToken } from "../github/github";
import { getHostState, requestHostWake } from "./host";
import {
  orcaWorkspacePath,
  parseOrcaReady,
  type OrcaPairing,
} from "./orca-pairing";
import {
  OrchestratorError,
  getIde,
  prepareIde,
  startIde,
  stopIde,
  touchIde,
  waitForOrchestrator,
  type IdeSession,
  type StartIdeInput,
} from "./orchestrator";
import { assertWorkspaceCreditQuota, QuotaError } from "./quotas";
import {
  classifyRuntimeFailure,
  RUNTIME_UNAVAILABLE_MESSAGE,
  type RuntimeUnavailable,
} from "./runtime-availability";
import { WorkspaceOpenTiming } from "../workspaces/workspace-open-timing";

const STALE_IDE_PROCESS_MESSAGE =
  "Orca IDE process exited before reporting readiness";

/**
 * How long the open path will sit waiting for a host that is not yet serving
 * before answering `host-starting`.
 *
 * This is deliberately far below `waitForOrchestrator`'s own 45s default. The
 * client polls this route every few seconds and treats a 202 as "still
 * booting", so blocking here buys nothing: it only pushes a single attempt
 * past the browser's request timeout, which aborts the fetch mid-wait and
 * starts the next attempt from the session probe again. A cold host takes
 * minutes to bootstrap — no single request was ever going to outlast it, so
 * answer quickly and let the poll do the waiting.
 *
 * `ensureHostReady` in orchestrator.ts keeps the long budget, because the
 * callers on that path (a mutating action) have no poll to fall back on.
 */
const OPEN_PATH_ORCHESTRATOR_WAIT_MS = 8_000;

/**
 * The same reasoning applied to a host caught mid-deallocate: wait one turn
 * for it to land in `stopped` so this request can start it, and otherwise
 * answer `host-starting` rather than holding the request open.
 */
const OPEN_PATH_STOPPING_ATTEMPTS = 2;

/**
 * Orchestrator responses that mean "ask again shortly" rather than "this
 * failed": the host is mid-restart (502/503/504), a call timed out while it
 * booted (408), it hit an internal blip (500), or every IDE slot is taken
 * (409) until the idle reaper frees one.
 */
const TRANSIENT_ORCHESTRATOR_STATUSES = new Set([408, 409, 500, 502, 503, 504]);

/**
 * Orchestrator refusals whose own text is about the member, not about CoDev's
 * infrastructure: out of credit, rate limited. Those pass through verbatim
 * because they name something the person can actually act on. Every other
 * status carries orchestrator-internal text and is reported generically.
 */
const MEMBER_ACTIONABLE_ORCHESTRATOR_STATUSES = new Set([402, 429]);

type OrcaWorkspace = {
  id: string;
  repository: string | null;
  repositoryVisibility: string | null;
  defaultBranch: string | null;
};

function orcaHostErrorFor(error: OrchestratorError): OrcaHostError {
  return MEMBER_ACTIONABLE_ORCHESTRATOR_STATUSES.has(error.status)
    ? new OrcaHostError(error.message, error.status)
    : new OrcaHostError(
        RUNTIME_UNAVAILABLE_MESSAGE,
        error.status,
        error.message,
      );
}

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
    /** Safe to show whoever opened the workspace. */
    message: string,
    readonly status = 502,
    /**
     * What actually happened, for the log. Defaults to `message` because some
     * of these — a credit quota, for one — are the member's own business and
     * read the same either way. The orchestrator's own text is not: it
     * describes CoDev's infrastructure and reached the workspace error panel
     * verbatim before this existed.
     */
    readonly detail: string = message,
  ) {
    super(message);
    this.name = "OrcaHostError";
  }
}

export type OrcaRuntimeState =
  | { state: "host-starting" }
  /**
   * The runtime cannot be reached at all and polling will not change that —
   * missing configuration, an empty credential chain, a host that is not in
   * the resource group. Distinct from `host-starting` because the client must
   * stop waiting and say why; see `runtime-availability.ts`.
   */
  | ({ state: "unavailable" } & RuntimeUnavailable)
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
    const hosted = await resolveHostedCodexSubscription({
      userId,
      workspaceId,
    });
    // Browser and CLI Codex logins store the same refreshable auth cache. The
    // orchestrator materializes it in this member's private CODEX_HOME, so
    // either provenance is valid when the member enabled it for workspaces.
    if (
      !hosted ||
      !hosted.credential.enabledForWorkspace ||
      !hosted.credential.encryptedMaterial
    ) {
      return undefined;
    }
    const material = await decryptHostedMaterial(
      hosted.credential.encryptedMaterial,
    );
    return material.authCacheJson || undefined;
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
    // Only a workspace-enabled, non-browser login (the API-key exchange)
    // reaches the host; Cursor's deeplink browser login is rooms-only.
    const auth = await resolveCursorCliAuth(userId, workspaceId, "workspace");
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
    return (
      (await resolveWorkspaceApiKey(userId, workspaceId, "cursor"))?.trim() ||
      undefined
    );
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
    return (
      (await resolveWorkspaceApiKey(userId, workspaceId, "openai"))?.trim() ||
      undefined
    );
  } catch {
    return undefined;
  }
}

/**
 * What the shared IDE host may run Claude with: a pasted API key, else the
 * `claude setup-token` the member uploaded with `codev claude-auth` (as
 * CLAUDE_CODE_OAUTH_TOKEN). A browser subscription stays in its private
 * runtime and is never copied to a shared IDE session — its credential is a
 * runtime reference CoDev never holds, so it could not be sent even by mistake.
 */
async function resolveClaudeEnvForIde(
  userId: string,
  workspaceId: string,
): Promise<
  { anthropicApiKey: string } | { claudeCodeOauthToken: string } | undefined
> {
  try {
    const apiKey = await resolveWorkspaceApiKey(
      userId,
      workspaceId,
      "anthropic",
    );
    if (apiKey?.trim()) return { anthropicApiKey: apiKey.trim() };
    const token = await resolveClaudeCliTokenForIde(userId, workspaceId);
    if (token?.trim()) return { claudeCodeOauthToken: token.trim() };
    return undefined;
  } catch {
    return undefined;
  }
}

async function resolveOrcaClone(
  workspace: OrcaWorkspace,
  userId: string,
): Promise<StartIdeInput["clone"]> {
  const token =
    workspace.repositoryVisibility === "private"
      ? await getGitHubUserToken(userId)
      : undefined;
  return workspace.repository && workspace.defaultBranch
    ? {
        repository: workspace.repository,
        defaultBranch: workspace.defaultBranch,
        ...(token ? { token } : {}),
      }
    : undefined;
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
 * Ensure the runtime host is running, the orchestrator is reachable, and this
 * workspace has its own dedicated Orca IDE process (cloning its repository
 * first if needed). Returns `host-starting` while the instance boots so the
 * client can poll.
 */
export async function ensureOrcaSession(
  workspace: OrcaWorkspace,
  userId: string,
  timing = new WorkspaceOpenTiming(),
): Promise<OrcaRuntimeState> {
  try {
    await timing.measure("quota", () =>
      assertWorkspaceCreditQuota(workspace.id, userId),
    );
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
  // A live session proves host readiness without host discovery and health polling.
  let running = false;
  try {
    const existing = await timing.measure("session_probe", () =>
      getIde(workspace.id, 1_500),
    );
    running = existing.workspaceId === workspace.id;
  } catch (error) {
    if (
      error instanceof OrchestratorError &&
      [401, 403].includes(error.status)
    ) {
      throw orcaHostErrorFor(error);
    }
    // A probe that failed because this environment has no runtime configured
    // is the answer, not a reason to go on and wake a host that isn't there.
    const unreachable = classifyRuntimeFailure(error);
    if (unreachable) return { state: "unavailable", ...unreachable };
  }
  if (!running) {
    try {
      const available = await timing.measure("host", async () => {
        const hostState = await getHostState();
        if (
          hostState !== "running" &&
          (await requestHostWake(OPEN_PATH_STOPPING_ATTEMPTS)) !== "running"
        ) {
          return false;
        }
        await waitForOrchestrator(OPEN_PATH_ORCHESTRATOR_WAIT_MS);
        return true;
      });
      if (!available) return { state: "host-starting" };
    } catch (error) {
      const unreachable = classifyRuntimeFailure(error);
      if (unreachable) return { state: "unavailable", ...unreachable };
      return { state: "host-starting" };
    }
  }

  const workspacePath = orcaWorkspacePath(workspace.id);
  const clone = await resolveOrcaClone(workspace, userId);
  const [
    codexAuthCacheJson,
    cursorAuthJson,
    cursorApiKey,
    openaiApiKey,
    claudeEnv,
  ] = await timing.measure("credentials", () =>
    Promise.all([
      resolveCodexAuthCacheForIde(userId, workspace.id),
      resolveCursorAuthJsonForIde(userId, workspace.id),
      resolveCursorApiKeyForIde(userId, workspace.id),
      resolveOpenAiApiKeyForIde(userId, workspace.id),
      resolveClaudeEnvForIde(userId, workspace.id),
    ]),
  );

  const coordinationMcpUrl = new URL(
    `/api/workspaces/${workspace.id}/mcp/coordination`,
    getPublicAppOrigin(),
  ).toString();

  try {
    const session = await timing.measure("connect", () =>
      startIdeRecoveringStaleProcess(workspace.id, {
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
      }),
    );
    const pairing = parseOrcaReady(session.ready, workspace.id);
    // Best-effort: a metering hiccup must never block the IDE from opening.
    await timing.measure("metering", () =>
      openOrcaInterval(userId, workspace.id).catch(() => {}),
    );
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
      throw orcaHostErrorFor(error);
    }
    throw error;
  }
}

/**
 * Prepare the repository directory without starting an Orca process. This is
 * the work done after a strong dashboard navigation intent, so cloning can
 * overlap the page navigation and the later `/orca` request only has to start
 * the already-prepared session.
 */
export async function prepareOrcaWorkspace(
  workspace: OrcaWorkspace,
  userId: string,
): Promise<"prepared" | "host-starting"> {
  try {
    await assertWorkspaceCreditQuota(workspace.id, userId);
  } catch (error) {
    if (error instanceof QuotaError) {
      throw new OrcaHostError(error.message, 429);
    }
    throw error;
  }

  try {
    if ((await requestHostWake(1)) !== "running") {
      return "host-starting";
    }
    await waitForOrchestrator(OPEN_PATH_ORCHESTRATOR_WAIT_MS);
  } catch (error) {
    const unavailable = classifyRuntimeFailure(error);
    if (unavailable) {
      throw new OrcaHostError(unavailable.message, 503, unavailable.detail);
    }
    return "host-starting";
  }

  const clone = await resolveOrcaClone(workspace, userId);
  try {
    await prepareIde(workspace.id, {
      projectRoot: orcaWorkspacePath(workspace.id),
      ...(clone ? { clone } : {}),
    });
    return "prepared";
  } catch (error) {
    if (
      error instanceof OrchestratorError &&
      TRANSIENT_ORCHESTRATOR_STATUSES.has(error.status)
    ) {
      return "host-starting";
    }
    if (error instanceof OrchestratorError) {
      throw orcaHostErrorFor(error);
    }
    throw error;
  }
}
