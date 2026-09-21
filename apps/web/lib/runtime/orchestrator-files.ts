import "server-only";

import { z } from "zod";

import { OrchestratorError, orchestratorRequest } from "./orchestrator-request";

export interface SandboxExecInput {
  command: string[];
  workingDir?: string | undefined;
  timeoutSeconds?: number | undefined;
  rows?: number | undefined;
  columns?: number | undefined;
  worktreeId?: string | undefined;
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
    /** Create missing directories on the way to `path`. */
    createParents?: boolean;
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
