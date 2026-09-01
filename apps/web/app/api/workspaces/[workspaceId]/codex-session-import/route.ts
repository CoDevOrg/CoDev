import { randomUUID } from "node:crypto";

import { z } from "zod";

import { requireWorkspacePermission } from "@/lib/access";
import { apiError, getApiUser } from "@/lib/api";
import {
  InvalidCodexRolloutError,
  codexRolloutSessionPath,
  parseCodexRolloutHeader,
} from "@/lib/codex-session-import";
import { executeInSandbox, writeSandboxFile } from "@/lib/orchestrator";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime-resume";

export const runtime = "nodejs";

const bodySchema = z.object({
  contents: z.string().min(1).max(2 * 1_024 * 1_024),
});

/**
 * Lands an uploaded local Codex session (a `~/.codex/sessions/**\/*.jsonl`
 * rollout the member exported from their own machine) inside this
 * workspace's sandbox so `codex resume <id>` can find it there.
 *
 * The sandbox's file-write API is deliberately jailed to the workspace/
 * worktree root (see the orchestrator's `resolve_for_write`), so the upload
 * lands there first, staged under a throwaway per-request name, then a short
 * `cp` via the sandbox's exec endpoint relocates it into the real Codex
 * session store. `sessionId` and the directory/filename below come only from
 * `codexRolloutSessionPath`, which builds them from a value already
 * validated against a strict UUID regex and digits pulled from a parsed
 * `Date`, never from unvalidated request text, so interpolating them into
 * the shell command is not an injection risk.
 *
 * `writeSandboxFile` requires its target's parent directory to already
 * exist -- `resolve_for_write` canonicalizes it and fails otherwise -- it
 * does not `mkdir -p` on the write's behalf. The staging directory has no
 * other reason to exist in a fresh workspace, so this creates it via exec
 * first. (Confirmed live: a workspace that had never used this import path
 * failed the write with an ENOENT on the staging directory, which the
 * orchestrator's generic non-2xx handling then relabeled "sandbox guest
 * unavailable" -- a real bug in this route, not an infrastructure outage.)
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "edit");
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 403,
    );
  }

  try {
    const { contents } = bodySchema.parse(await request.json());
    const rollout = parseCodexRolloutHeader(contents);
    const { directory, filename } = codexRolloutSessionPath(rollout);

    await ensureWorkspaceRuntimeReady(workspaceId, user.id);

    // TEMP DIAGNOSTIC -- remove before merging. Reports exactly what
    // environment this route's own executeInSandbox calls run in, to settle
    // whether it shares a filesystem view with the interactive PTY terminal.
    const diag = await executeInSandbox(workspaceId, {
      command: [
        "sh",
        "-c",
        "echo PWD=$(pwd) && echo WHOAMI=$(whoami) && echo HOME=$HOME && echo LS_ROOT=$(ls -la / 2>&1 | tr '\\n' '|') && echo FIND_IMPORT=$(find .codev-import -type f 2>&1 | tr '\\n' '|')",
      ],
      timeoutSeconds: 30,
    });
    return Response.json({ diag: diag.output, exitCode: diag.exitCode });

    const mkdirStaging = await executeInSandbox(workspaceId, {
      command: ["mkdir", "-p", ".codev-import/codex-sessions"],
      timeoutSeconds: 30,
    });
    if (mkdirStaging.exitCode !== 0) {
      return apiError(
        new Error(
          `Could not prepare the workspace host for the upload: ${mkdirStaging.output.slice(0, 500)}`,
        ),
        502,
      );
    }

    // A per-request staging name, not the session id, so a retried or
    // duplicate upload never collides with an earlier attempt still sitting
    // in the sandbox's import scratch space.
    const stagingPath = `.codev-import/codex-sessions/${randomUUID()}.jsonl`;
    await writeSandboxFile(workspaceId, {
      path: stagingPath,
      contents,
      expectedRevision: "missing",
    });

    const destination = `~/.codex/sessions/${directory}/${filename}`;
    const result = await executeInSandbox(workspaceId, {
      command: [
        "sh",
        "-c",
        `mkdir -p ~/.codex/sessions/${directory} && cp ${stagingPath} ${destination} && rm -f ${stagingPath}`,
      ],
      timeoutSeconds: 30,
    });
    if (result.exitCode !== 0) {
      return apiError(
        new Error(
          `Could not place the session on the workspace host: ${result.output.slice(0, 500)}`,
        ),
        502,
      );
    }

    return Response.json({
      sessionId: rollout.sessionId,
      resumeCommand: `codex resume ${rollout.sessionId}`,
    });
  } catch (error) {
    if (error instanceof InvalidCodexRolloutError) {
      return apiError(error, 400);
    }
    return apiError(error);
  }
}
