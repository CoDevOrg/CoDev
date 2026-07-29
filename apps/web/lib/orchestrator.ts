import "server-only";

import { Sha256 } from "@aws-crypto/sha256-js";
import { readServerEnvironment } from "@codev/config";
import { sandboxInstanceSchema, type SandboxInstance } from "@codev/contracts";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";
import { z } from "zod";

import { getAwsConfiguration } from "./aws";

const errorSchema = z.object({ error: z.string() });

export class OrchestratorError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OrchestratorError";
  }
}

export interface ProvisionSandboxInput {
  workspaceId: string;
  repositoryUrl: string;
  baseSha: string;
  expiresAt: string;
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

function getOrchestratorConfiguration() {
  const environment = readServerEnvironment();
  if (!environment.AWS_REGION) {
    throw new Error("AWS_REGION is not configured.");
  }
  if (!environment.ORCHESTRATOR_URL) {
    throw new Error("ORCHESTRATOR_URL is not configured.");
  }
  return {
    ...getAwsConfiguration(),
    endpoint: environment.ORCHESTRATOR_URL,
  };
}

async function orchestratorRequest(
  method: string,
  path: string,
  body?: unknown,
) {
  const configuration = getOrchestratorConfiguration();
  const url = new URL(path, configuration.endpoint);
  const encodedBody = body === undefined ? undefined : JSON.stringify(body);
  const headers: Record<string, string> = {
    accept: "application/json",
    host: url.host,
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
    signal: AbortSignal.timeout(70_000),
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
    );
  }
  return response;
}

export async function checkOrchestratorConnection() {
  const response = await orchestratorRequest("GET", "/healthz");
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

export async function createSandboxWorktree(
  workspaceId: string,
  worktreeId: string,
  headSha: string,
) {
  await orchestratorRequest("POST", `/v1/sandboxes/${workspaceId}/worktrees`, {
    worktreeId,
    headSha,
  });
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
