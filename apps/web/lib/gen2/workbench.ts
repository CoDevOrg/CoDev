import "server-only";

import type { Gen2FileEntry, Gen2FileSearchMatch } from "@codev/contracts";

import {
  executeInSandbox,
  getSandboxGitOutput,
  readSandboxFile,
  writeSandboxFile,
} from "../runtime/orchestrator-files";
import { OrchestratorError } from "../runtime/orchestrator-request";
import {
  attachGitStatus,
  parseFileList,
  parseSearchMatches,
} from "../runtime/ide";
import { requireWorkspacePermission } from "../policies/workspace";
import { canRunGen2Agent } from "./agent-policy";
import { Gen2FileConflictError, Gen2LifecycleError } from "./errors";
import { getGen2WorkspaceForAccess } from "./workspaces";

/**
 * Files and Git for a Gen 2 workspace, addressed against the same Firecracker
 * guest Codex runs in — the file a member opens here is the file the agent
 * just edited.
 *
 * Every function in this module takes `userId` and enforces a named capability
 * *before* it touches the orchestrator. That is deliberate:
 * `lib/runtime/orchestrator-*` performs no authorization at all, so a route
 * that reached it directly would be an IDOR across every Gen 2 workspace.
 */

/** Guest handlers that take the mutation lock stall until a turn finishes. */
async function requireReadyWorkspace(
  workspaceId: string,
  userId: string,
  permission: "workspace.view" | "workspace.editFiles",
) {
  const access = await requireWorkspacePermission(
    workspaceId,
    userId,
    permission,
  );
  const workspace = await getGen2WorkspaceForAccess(workspaceId, access);
  if (!canRunGen2Agent(workspace.status)) {
    throw new Gen2LifecycleError(
      workspace.status === "provisioning"
        ? "The instance is still starting."
        : "Start the instance first.",
    );
  }
  return workspace;
}

export async function listGen2Files(
  workspaceId: string,
  userId: string,
): Promise<Gen2FileEntry[]> {
  await requireReadyWorkspace(workspaceId, userId, "workspace.view");
  const [files, status] = await Promise.all([
    listGuestFiles(workspaceId),
    getSandboxGitOutput(workspaceId, "status"),
  ]);
  return attachGitStatus(parseFileList(files), status).map((file) => ({
    path: file.path,
    status: file.status ?? null,
  }));
}

/**
 * `find` rather than `git ls-files`: the agent's brand-new, never-staged files
 * have to show up in the tree the moment it creates them.
 */
async function listGuestFiles(workspaceId: string) {
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
    throw new Gen2LifecycleError("Could not list the workspace files.", 502);
  }
  return result.output;
}

export async function searchGen2Files(
  workspaceId: string,
  userId: string,
  query: string,
): Promise<Gen2FileSearchMatch[]> {
  await requireReadyWorkspace(workspaceId, userId, "workspace.view");
  const result = await executeInSandbox(workspaceId, {
    // `--untracked` is the difference that matters here: without it, a file
    // the agent created moments ago is invisible to search until someone
    // stages it.
    command: [
      "git",
      "grep",
      "--line-number",
      "--color=never",
      "-I",
      "--untracked",
      "--max-count",
      "100",
      "--",
      query,
    ],
    timeoutSeconds: 30,
  });
  // git grep exits 1 when it simply found nothing.
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Gen2LifecycleError("Workspace search failed.", 502);
  }
  return parseSearchMatches(result.output).slice(0, 500);
}

export async function readGen2File(
  workspaceId: string,
  userId: string,
  path: string,
) {
  // Reading does not take the guest mutation lock, so it keeps working while
  // a Codex turn runs. `workspace.view` is still required.
  await requireWorkspacePermission(workspaceId, userId, "workspace.view");
  return readSandboxFile(workspaceId, path);
}

const REVISION_MISMATCH = /current revision is (\S+)/;

export async function writeGen2File(
  workspaceId: string,
  userId: string,
  input: { path: string; contents: string; expectedRevision: string },
) {
  await requireReadyWorkspace(workspaceId, userId, "workspace.editFiles");
  try {
    return await writeSandboxFile(workspaceId, input);
  } catch (error) {
    if (error instanceof OrchestratorError && error.status === 409) {
      const current = REVISION_MISMATCH.exec(error.message)?.[1];
      throw new Gen2FileConflictError(input.path, current ?? "unknown");
    }
    throw error;
  }
}

/**
 * Drop a file onto the machine.
 *
 * The guest writes UTF-8, so binary uploads are refused here with a clear
 * message rather than silently corrupted. `"missing"` is the revision the
 * guest reports for a path that does not exist, which makes this a create
 * that will not clobber an existing file.
 */
export async function uploadGen2File(
  workspaceId: string,
  userId: string,
  input: { path: string; contents: string; overwrite?: boolean },
) {
  await requireReadyWorkspace(workspaceId, userId, "workspace.editFiles");
  try {
    return await writeSandboxFile(workspaceId, {
      path: input.path,
      contents: input.contents,
      expectedRevision: input.overwrite
        ? ((await readSandboxFile(workspaceId, input.path).catch(() => null))
            ?.revision ?? "missing")
        : "missing",
      createParents: true,
    });
  } catch (error) {
    if (error instanceof OrchestratorError && error.status === 409) {
      throw new Gen2FileConflictError(input.path, "exists");
    }
    throw error;
  }
}

/**
 * `git status` and `git diff` are the one runtime surface the guest serves
 * without waiting for Codex to go idle, so the Git tab stays live during a
 * turn. `workspace.view` is enough — no ready gate, so it keeps answering.
 */
export async function getGen2Git(
  workspaceId: string,
  userId: string,
  operation: "status" | "diff",
) {
  await requireWorkspacePermission(workspaceId, userId, "workspace.view");
  return getSandboxGitOutput(workspaceId, operation);
}

export async function showGen2HeadFile(
  workspaceId: string,
  userId: string,
  path: string,
) {
  await requireReadyWorkspace(workspaceId, userId, "workspace.view");
  const result = await executeInSandbox(workspaceId, {
    command: ["git", "show", `HEAD:./${path}`],
    timeoutSeconds: 30,
  });
  // A file the agent just created has no HEAD version; that is not an error.
  return {
    contents: result.exitCode === 0 ? result.output : "",
    exists: result.exitCode === 0,
  };
}
