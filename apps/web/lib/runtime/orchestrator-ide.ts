import "server-only";

import { z } from "zod";

import { OrchestratorError, orchestratorRequest } from "./orchestrator-request";

const ideSessionSchema = z.object({
  workspaceId: z.string().min(1),
  port: z.number().int(),
  createdAt: z.string(),
  lastActivityAt: z.string(),
  /** The verbatim `orca_server_ready` JSON; parsed by apps/web/lib/runtime/orca-pairing.ts. */
  ready: z.unknown(),
});

export type IdeSession = z.infer<typeof ideSessionSchema>;

export interface StartIdeInput {
  projectRoot: string;
  clone?: {
    repository: string;
    defaultBranch: string;
    token?: string;
  };
  /** See IdeStartRequest's doc comment in services/orchestrator/src/model.rs. */
  codexAuthCacheJson?: string;
  anthropicApiKey?: string;
  claudeCodeOauthToken?: string;
  /**
   * The Cursor CLI login token pair as `auth.json` contents, filed per member
   * with `XDG_CONFIG_HOME` pointed at it. Preferred over `cursorApiKey`.
   */
  cursorAuthJson?: string;
  /** A pasted Cursor API key, filed as `CURSOR_API_KEY` when no login exists. */
  cursorApiKey?: string;
  /** A plain OpenAI API key, the API-key fallback for the interactive Codex CLI. */
  openaiApiKey?: string;
  /**
   * The member the credentials above belong to. A workspace is shared but a
   * linked subscription is personal, so the host files them under this id and
   * hands them only to agents this member launches.
   */
  memberId?: string;
  /**
   * Coordination MCP endpoint + a workspace-scoped bearer token. The host
   * seeds them into every agent CLI's own config — `~/.claude.json` for
   * Claude Code, `config.toml` for Codex — so whichever agent a member
   * launches reaches the same workspace brain / path-claim system. Both or
   * neither.
   */
  coordinationMcpUrl?: string;
  coordinationMcpToken?: string;
}

export interface PrepareIdeInput {
  projectRoot: string;
  clone?: {
    repository: string;
    defaultBranch: string;
    token?: string;
  };
}

export async function prepareIde(
  workspaceId: string,
  input: PrepareIdeInput,
): Promise<void> {
  await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/ide/prepare`,
    input,
    110_000,
  );
}

/**
 * Start (or idempotently return) this workspace's dedicated per-workspace
 * Orca IDE process. Replaces the previous SSM RunCommand flow entirely: the
 * orchestrator both clones the repository (if `clone` is given and the
 * directory isn't already a git repo) and spawns/tracks `orca serve` itself.
 */
export async function startIde(
  workspaceId: string,
  input: StartIdeInput,
): Promise<IdeSession> {
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/ide`,
    input,
    110_000,
  );
  return z.object({ ide: ideSessionSchema }).parse(await response.json()).ide;
}

/**
 * Refresh the member-scoped agent credential bundle after the IDE is ready.
 * This is intentionally separate from `startIde` so provider lookups and
 * host-side file writes cannot delay workspace readiness.
 */
export async function refreshIdeCredentials(
  workspaceId: string,
  input: StartIdeInput,
): Promise<void> {
  await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/ide/credentials`,
    input,
    30_000,
  );
}

export async function getIde(
  workspaceId: string,
  timeoutMs = 70_000,
): Promise<IdeSession> {
  const response = await orchestratorRequest(
    "GET",
    `/v1/sandboxes/${workspaceId}/ide`,
    undefined,
    timeoutMs,
  );
  return z.object({ ide: ideSessionSchema }).parse(await response.json()).ide;
}

/**
 * Keep this workspace's IDE session marked as in use. The Orca web client
 * talks straight to `orca serve` through the host's Caddy, so the
 * orchestrator sees no traffic at all while somebody works - without this the
 * session reaper and the host's idle shutdown would both count an active
 * session as idle.
 */
export async function touchIde(workspaceId: string): Promise<IdeSession> {
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/ide/activity`,
  );
  return z.object({ ide: ideSessionSchema }).parse(await response.json()).ide;
}

/**
 * Write a file into the workspace's IDE session, on the host filesystem the
 * member's own terminals and agent CLIs actually run in.
 *
 * Not interchangeable with `writeSandboxFile`. That one reaches the
 * Firecracker guest daemon, which runs as root in a microVM against its own
 * `/workspace` disk; an interactive terminal tab, `codex`, `git`, or any
 * agent CLI runs somewhere else entirely - on the host, as `orca-ws-<id>`,
 * under `/srv/codev/workspaces/<id>`. A file written through the sandbox path
 * is invisible to every one of them, and the write still reports success. Use
 * this whenever the whole point is that some later interactive process finds
 * the file.
 *
 * `root` picks which of the session's two writable trees `path` is relative
 * to: the workspace clone (`"project"`, the default) or the workspace user's
 * home (`"home"`, where the agent CLIs keep `~/.codex`, `~/.claude.json`, and
 * the rest of their state). Parent directories are created as needed.
 */
export async function writeIdeFile(
  workspaceId: string,
  input: { path: string; contents: string; root?: "project" | "home" },
) {
  await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/ide/files/write`,
    input,
  );
}

/**
 * Run a command inside the workspace's IDE session, as its unprivileged
 * Linux user - the same environment the member's own terminals run in.
 *
 * The IDE-session counterpart to `executeInSandbox`, which runs as root
 * inside the microVM instead. `command` is passed as argv and never through a
 * shell, so there is no quoting to get right.
 */
export async function executeInIde(
  workspaceId: string,
  input: {
    command: string[];
    root?: "project" | "home";
    timeoutSeconds?: number;
  },
) {
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/ide/exec`,
    input,
  );
  return z
    .object({
      result: z.object({
        output: z.string(),
        exitCode: z.number().int(),
      }),
    })
    .parse(await response.json()).result;
}

export async function stopIde(workspaceId: string) {
  try {
    await orchestratorRequest("DELETE", `/v1/sandboxes/${workspaceId}/ide`);
  } catch (error) {
    if (error instanceof OrchestratorError && error.status === 404) return;
    throw error;
  }
}
