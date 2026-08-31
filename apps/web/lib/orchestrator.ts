import "server-only";

import { Sha256 } from "@aws-crypto/sha256-js";
import { readServerEnvironment } from "@codev/config";
import { sandboxInstanceSchema, type SandboxInstance } from "@codev/contracts";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";
import { z } from "zod";

import { getAwsConfiguration } from "./aws";
import type { RepositorySnapshot } from "./github";

const errorSchema = z.object({
  error: z.string(),
  conflictPaths: z.array(z.string()).optional(),
});

export class OrchestratorError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly conflictPaths: string[] = [],
  ) {
    super(message);
    this.name = "OrchestratorError";
  }
}

export interface ProvisionSandboxInput {
  workspaceId: string;
  repositoryUrl: string | null;
  repositorySnapshot?: RepositorySnapshot;
  baseSha: string;
  expiresAt: string;
  resumeFromSnapshot: boolean;
  lifecycle: {
    timeoutMs: number;
    lifecycle: { onTimeout: "pause"; autoResume: true };
  };
}

export interface SandboxExecInput {
  command: string[];
  workingDir?: string | undefined;
  timeoutSeconds?: number | undefined;
  rows?: number | undefined;
  columns?: number | undefined;
  worktreeId?: string | undefined;
}

const terminalPollSchema = z.object({
  chunks: z.array(
    z.object({
      sequence: z.number().int().nonnegative(),
      data: z.string(),
    }),
  ),
  nextSequence: z.number().int().nonnegative(),
  exited: z.boolean(),
  exitCode: z.number().int().nullable(),
});

const codexExecPollSchema = z.object({
  chunks: z.array(
    z.object({
      sequence: z.number().int().nonnegative(),
      dataBase64: z.string(),
    }),
  ),
  nextSequence: z.number().int().nonnegative(),
  exited: z.boolean(),
  exitCode: z.number().int().nullable(),
  codexAuthCacheJson: z.string().optional(),
});

const publicationExportSchema = z.object({
  headSha: z.string().regex(/^[0-9a-f]{40}$/),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(4_096),
        mode: z.enum(["100644", "100755", "120000"]),
        contentBase64: z.string(),
      }),
    )
    .max(500),
  totalBytes: z
    .number()
    .int()
    .nonnegative()
    .max(5 * 1_024 * 1_024),
});

function getOrchestratorConfiguration() {
  const environment = readServerEnvironment();
  const endpoint =
    environment.ORCHESTRATOR_URL && environment.ORCHESTRATOR_URL.trim() !== ""
      ? environment.ORCHESTRATOR_URL
      : "https://y0h0aur7sc.execute-api.us-east-2.amazonaws.com";
  return {
    ...getAwsConfiguration(),
    endpoint,
  };
}

async function orchestratorRequest(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 70_000,
) {
  const configuration = getOrchestratorConfiguration();
  const url = new URL(path, configuration.endpoint);
  const encodedBody = body === undefined ? undefined : JSON.stringify(body);
  const headers: Record<string, string> = {
    accept: "application/json",
    host: url.host,
    "x-codev-request-id": crypto.randomUUID(),
  };
  if (encodedBody !== undefined) {
    headers["content-type"] = "application/json";
  }
  const signer = new SignatureV4({
    credentials: configuration.credentials,
    region: configuration.region,
    service: "execute-api",
    sha256: Sha256,
  });
  const signed = await signer.sign(
    new HttpRequest({
      protocol: url.protocol,
      hostname: url.hostname,
      method,
      path: `${url.pathname}${url.search}`,
      headers,
      ...(url.port ? { port: Number(url.port) } : {}),
      ...(encodedBody === undefined ? {} : { body: encodedBody }),
    }),
  );
  const response = await fetch(url, {
    method,
    headers: signed.headers,
    ...(encodedBody === undefined ? {} : { body: encodedBody }),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const payload = errorSchema.safeParse(
      await response.json().catch(() => null),
    );
    throw new OrchestratorError(
      payload.success
        ? payload.data.error
        : `Sandbox service returned HTTP ${response.status}.`,
      response.status,
      payload.success ? (payload.data.conflictPaths ?? []) : [],
    );
  }
  return response;
}

/**
 * Direct HTTPS path to the orchestrator (see ORCHESTRATOR_DIRECT_URL), used
 * only for calls that can legitimately run longer than the API Gateway
 * Lambda proxy's hard 29-second integration timeout — currently just the
 * authenticated Codex exec. Everything else keeps using orchestratorRequest.
 */
async function orchestratorDirectRequest(
  method: string,
  path: string,
  body: unknown,
  timeoutMs: number,
) {
  const environment = readServerEnvironment();
  const endpoint = environment.ORCHESTRATOR_DIRECT_URL;
  const secret = environment.ORCHESTRATOR_DIRECT_SECRET;
  if (!endpoint || !secret) {
    throw new Error(
      "ORCHESTRATOR_DIRECT_URL/ORCHESTRATOR_DIRECT_SECRET are not configured.",
    );
  }
  // `new URL(path, base)` treats a leading-slash path as origin-relative,
  // which would silently drop the direct endpoint's own path prefix — join
  // as plain strings instead.
  const url = `${endpoint.replace(/\/+$/, "")}${path}`;
  const encodedBody = body === undefined ? undefined : JSON.stringify(body);
  const response = await fetch(url, {
    method,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${secret}`,
      ...(encodedBody === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    ...(encodedBody === undefined ? {} : { body: encodedBody }),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const payload = errorSchema.safeParse(
      await response.json().catch(() => null),
    );
    throw new OrchestratorError(
      payload.success
        ? payload.data.error
        : `Sandbox service returned HTTP ${response.status}.`,
      response.status,
      payload.success ? (payload.data.conflictPaths ?? []) : [],
    );
  }
  return response;
}

/**
 * Routes to the direct-bypass endpoint (see orchestratorDirectRequest) when
 * configured, else falls back to the standard signed path — used only for
 * Codex exec calls, the sole reason ORCHESTRATOR_DIRECT_* exists.
 */
async function codexExecRequest(
  method: string,
  path: string,
  body: unknown,
  timeoutMs: number,
) {
  const environment = readServerEnvironment();
  return environment.ORCHESTRATOR_DIRECT_URL &&
    environment.ORCHESTRATOR_DIRECT_SECRET
    ? orchestratorDirectRequest(method, path, body, timeoutMs)
    : orchestratorRequest(method, path, body, timeoutMs);
}

export async function checkOrchestratorConnection(timeoutMs = 4_000) {
  const response = await orchestratorRequest(
    "GET",
    "/healthz",
    undefined,
    timeoutMs,
  );
  return z
    .object({
      status: z.literal("ok"),
      service: z.literal("codev-orchestrator"),
    })
    .parse(await response.json());
}

export async function waitForOrchestrator() {
  const deadline = Date.now() + 45_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await checkOrchestratorConnection();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 2_500));
    }
  }

  throw new Error(
    `The Firecracker host started but its orchestrator did not become healthy: ${
      lastError instanceof Error ? lastError.message : "unknown error"
    }`,
  );
}

export async function provisionSandbox(
  input: ProvisionSandboxInput,
): Promise<SandboxInstance> {
  const response = await orchestratorRequest("POST", "/v1/sandboxes", input);
  const payload = z
    .object({ sandbox: sandboxInstanceSchema })
    .parse(await response.json());
  return payload.sandbox;
}

export async function getSandbox(
  workspaceId: string,
): Promise<SandboxInstance> {
  const response = await orchestratorRequest(
    "GET",
    `/v1/sandboxes/${workspaceId}`,
  );
  const payload = z
    .object({ sandbox: sandboxInstanceSchema })
    .parse(await response.json());
  return payload.sandbox;
}

export async function destroySandbox(workspaceId: string) {
  try {
    await orchestratorRequest("DELETE", `/v1/sandboxes/${workspaceId}`);
  } catch (error) {
    if (error instanceof OrchestratorError && error.status === 404) {
      return;
    }
    throw error;
  }
}

export async function resumeSandbox(workspaceId: string) {
  try {
    await orchestratorRequest("POST", `/v1/sandboxes/${workspaceId}/resume`);
  } catch (error) {
    if (error instanceof OrchestratorError && error.status === 404) return;
    throw error;
  }
}

export async function discardSandboxSnapshot(workspaceId: string) {
  try {
    await orchestratorRequest(
      "DELETE",
      `/v1/sandboxes/${workspaceId}/snapshot`,
    );
  } catch (error) {
    if (error instanceof OrchestratorError && error.status === 404) return;
    throw error;
  }
}

const ideSessionSchema = z.object({
  workspaceId: z.string().min(1),
  port: z.number().int(),
  createdAt: z.string(),
  lastActivityAt: z.string(),
  /** The verbatim `orca_server_ready` JSON; parsed by apps/web/lib/orca-pairing.ts. */
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

export async function getIde(workspaceId: string): Promise<IdeSession> {
  const response = await orchestratorRequest(
    "GET",
    `/v1/sandboxes/${workspaceId}/ide`,
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

export async function stopIde(workspaceId: string) {
  try {
    await orchestratorRequest("DELETE", `/v1/sandboxes/${workspaceId}/ide`);
  } catch (error) {
    if (error instanceof OrchestratorError && error.status === 404) return;
    throw error;
  }
}

export async function touchSandbox(workspaceId: string) {
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/activity`,
  );
  return z
    .object({ sandbox: sandboxInstanceSchema })
    .parse(await response.json()).sandbox;
}

export async function snapshotWorkspace(
  workspaceId: string,
  expectedHeadSha: string,
) {
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/snapshot`,
    { expectedHeadSha },
  );
  return publicationExportSchema.parse(await response.json());
}

export async function createSandboxWorktree(
  workspaceId: string,
  worktreeId: string,
  headSha: string,
  branchName?: string,
) {
  await orchestratorRequest("POST", `/v1/sandboxes/${workspaceId}/worktrees`, {
    worktreeId,
    headSha,
    ...(branchName ? { branchName } : {}),
  });
}

export async function exportSandboxPublication(
  workspaceId: string,
  expectedHeadSha: string,
  worktreeId?: string,
) {
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/publication/export`,
    {
      expectedHeadSha,
      ...(worktreeId ? { worktreeId } : {}),
    },
  );
  return publicationExportSchema.parse(await response.json());
}

export async function deleteSandboxWorktree(
  workspaceId: string,
  worktreeId: string,
) {
  await orchestratorRequest(
    "DELETE",
    `/v1/sandboxes/${workspaceId}/worktrees/${worktreeId}`,
  );
}

const worktreeReviewSchema = z.object({
  baseSha: z.string().regex(/^[0-9a-f]{40}$/),
  headSha: z.string().regex(/^[0-9a-f]{40}$/),
  diff: z.string(),
  diffDigest: z.string().regex(/^[0-9a-f]{64}$/),
});

export type SandboxWorktreeReview = z.infer<typeof worktreeReviewSchema>;

export async function checkpointSandboxWorktree(
  workspaceId: string,
  worktreeId: string,
  expectedHeadSha: string,
) {
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/worktrees/${worktreeId}/checkpoint`,
    { expectedHeadSha },
  );
  return z
    .object({ headSha: z.string().regex(/^[0-9a-f]{40}$/) })
    .parse(await response.json());
}

export async function reviewSandboxWorktree(
  workspaceId: string,
  worktreeId: string,
  baseSha: string,
) {
  const response = await orchestratorRequest(
    "GET",
    `/v1/sandboxes/${workspaceId}/worktrees/${worktreeId}/review?baseSha=${encodeURIComponent(baseSha)}`,
  );
  return worktreeReviewSchema.parse(await response.json());
}

export async function rebaseSandboxWorktree(
  workspaceId: string,
  worktreeId: string,
  input: { expectedHeadSha: string; ontoSha: string },
) {
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/worktrees/${worktreeId}/rebase`,
    input,
  );
  return z
    .object({ headSha: z.string().regex(/^[0-9a-f]{40}$/) })
    .parse(await response.json());
}

export async function mergeSandboxWorktree(
  workspaceId: string,
  worktreeId: string,
  input: {
    expectedIntegrationHeadSha: string;
    expectedWorktreeHeadSha: string;
    expectedDiffDigest: string;
  },
) {
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/worktrees/${worktreeId}/merge`,
    input,
  );
  return z
    .object({ headSha: z.string().regex(/^[0-9a-f]{40}$/) })
    .parse(await response.json());
}

export async function readSandboxFile(
  workspaceId: string,
  path: string,
  worktreeId?: string,
) {
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/files/read`,
    { path, worktreeId },
  );
  return z
    .object({
      file: z.object({
        path: z.string(),
        contents: z.string(),
        revision: z.string(),
      }),
    })
    .parse(await response.json()).file;
}

export async function writeSandboxFile(
  workspaceId: string,
  input: {
    path: string;
    contents: string;
    expectedRevision: string;
    worktreeId?: string;
  },
) {
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/files/write`,
    input,
  );
  return z.object({ revision: z.string() }).parse(await response.json());
}

export async function executeInSandbox(
  workspaceId: string,
  input: SandboxExecInput,
) {
  // The guest exec endpoint uses a PTY. Give non-interactive commands a wide
  // viewport so file paths, Git porcelain, and search matches are not wrapped
  // before the website parses them.
  const command = {
    rows: 1_000,
    columns: 4_096,
    ...input,
  };
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/pty/exec`,
    command,
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

/**
 * The original single-call Codex exec path: one HTTP request that blocks
 * for up to 910s while the whole turn runs. Superseded by
 * startCodexExecInSandbox/pollCodexExecInSandbox/closeCodexExecInSandbox
 * below, which stream a long-running turn as a series of short calls
 * instead. Left in place, unused by the default agent-runtime flow, as a
 * rollback path — see the "Async Codex exec + polling" plan's rollout
 * notes for why the guest side can't be swapped over uniformly in one step.
 */
export async function executeCodexInSandbox(
  workspaceId: string,
  input: SandboxExecInput & { codexAuthCacheJson: string },
) {
  const path = `/v1/sandboxes/${workspaceId}/pty/exec`;
  const body = { rows: 1_000, columns: 4_096, ...input };
  const response = await codexExecRequest("POST", path, body, 910_000);
  return z
    .object({
      result: z.object({
        output: z.string(),
        exitCode: z.number().int(),
        codexAuthCacheJson: z.string().optional(),
      }),
    })
    .parse(await response.json()).result;
}

export async function startCodexExecInSandbox(
  workspaceId: string,
  input: SandboxExecInput & {
    codexAuthCacheJson: string;
    idempotencyKey: string;
  },
) {
  const body = { rows: 1_000, columns: 4_096, ...input };
  const response = await codexExecRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/codex-execs`,
    body,
    20_000,
  );
  return z.object({ sessionId: z.string() }).parse(await response.json())
    .sessionId;
}

export async function pollCodexExecInSandbox(
  workspaceId: string,
  sessionId: string,
  after: number,
) {
  const response = await codexExecRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/codex-execs/${sessionId}/poll`,
    { after, waitMilliseconds: 25_000 },
    35_000,
  );
  return z.object({ result: codexExecPollSchema }).parse(await response.json())
    .result;
}

export async function closeCodexExecInSandbox(
  workspaceId: string,
  sessionId: string,
) {
  await codexExecRequest(
    "DELETE",
    `/v1/sandboxes/${workspaceId}/codex-execs/${sessionId}`,
    undefined,
    20_000,
  );
}

export async function getSandboxGitOutput(
  workspaceId: string,
  operation: "status" | "diff",
  worktreeId?: string,
) {
  const query = worktreeId
    ? `?worktreeId=${encodeURIComponent(worktreeId)}`
    : "";
  const response = await orchestratorRequest(
    "GET",
    `/v1/sandboxes/${workspaceId}/git/${operation}${query}`,
  );
  return z.object({ output: z.string() }).parse(await response.json()).output;
}

export async function listSandboxFiles(workspaceId: string) {
  const result = await executeInSandbox(workspaceId, {
    command: [
      "find",
      ".",
      "-type",
      "f",
      "-not",
      "-path",
      "./.git/*",
      "-not",
      "-path",
      "./node_modules/*",
      "-not",
      "-path",
      "./target/*",
    ],
    timeoutSeconds: 30,
  });
  if (result.exitCode !== 0) {
    throw new OrchestratorError("Could not list workspace files.", 502);
  }
  return result.output;
}

export async function searchSandboxFiles(workspaceId: string, query: string) {
  const result = await executeInSandbox(workspaceId, {
    command: [
      "git",
      "grep",
      "--line-number",
      "--color=never",
      "-I",
      "--max-count",
      "100",
      "--",
      query,
      ".",
    ],
    timeoutSeconds: 30,
  });
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new OrchestratorError("Workspace search failed.", 502);
  }
  return result.output;
}

export async function readSandboxHeadFile(workspaceId: string, path: string) {
  const result = await executeInSandbox(workspaceId, {
    command: ["git", "show", `HEAD:./${path}`],
    timeoutSeconds: 30,
  });
  if (result.exitCode !== 0) return "";
  return result.output;
}

export async function startSandboxTerminal(
  workspaceId: string,
  input: { rows: number; columns: number },
) {
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/terminals`,
    input,
  );
  return z.object({ sessionId: z.string() }).parse(await response.json())
    .sessionId;
}

export async function sendSandboxTerminalInput(
  workspaceId: string,
  sessionId: string,
  data: string,
) {
  await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/terminals/${sessionId}/input`,
    { data },
  );
}

export async function resizeSandboxTerminal(
  workspaceId: string,
  sessionId: string,
  input: { rows: number; columns: number },
) {
  await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/terminals/${sessionId}/resize`,
    input,
  );
}

export async function pollSandboxTerminal(
  workspaceId: string,
  sessionId: string,
  after: number,
) {
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/terminals/${sessionId}/poll`,
    { after, waitMilliseconds: 20_000 },
  );
  return z.object({ result: terminalPollSchema }).parse(await response.json())
    .result;
}

export async function closeSandboxTerminal(
  workspaceId: string,
  sessionId: string,
) {
  await orchestratorRequest(
    "DELETE",
    `/v1/sandboxes/${workspaceId}/terminals/${sessionId}`,
  );
}
