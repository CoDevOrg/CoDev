import { z } from "zod";

import { requireWorkspacePermission } from "@/lib/access";
import { apiError, getApiUser } from "@/lib/api";
import {
  InvalidCodexRolloutError,
  codexRolloutSessionPath,
  parseCodexRolloutHeader,
} from "@/lib/codex-session-import";
import { OrcaHostError, ensureOrcaSession } from "@/lib/orca-host";
import { writeIdeFile } from "@/lib/orchestrator";
import { getWorkspaceForMember } from "@/lib/workspaces";

export const runtime = "nodejs";

const bodySchema = z.object({
  contents: z
    .string()
    .min(1)
    .max(2 * 1_024 * 1_024),
});

/**
 * Lands an uploaded local Codex session (a `~/.codex/sessions/**\/*.jsonl`
 * rollout the member exported from their own machine) inside this workspace's
 * IDE session, so `codex resume <id>` typed into a terminal tab finds it.
 *
 * This deliberately targets the IDE session's own host filesystem
 * (`writeIdeFile`) rather than the sandbox (`writeSandboxFile`). The two are
 * different machines: the sandbox write path reaches a guest daemon running
 * as root inside a Firecracker microVM against its own `/workspace` disk,
 * while the terminal the member actually types into runs on the host as
 * `orca-ws-<id>`. An earlier version of this route used the sandbox path, and
 * every import silently succeeded while placing the file somewhere no Codex
 * CLI would ever look.
 *
 * The rollout is filed into both Codex homes a member's CLI can be pointed
 * at: the per-workspace user's default `~/.codex`, and the per-member home
 * under `~/.codev/agents/<memberId>` that `CODEX_HOME` is set to for a member
 * with a linked hosted Codex subscription. Which one applies depends on that
 * member's provider links and can change after the import, so writing both is
 * what actually keeps `codex resume` working, and the two stores are separate
 * trees where a spare copy costs nothing.
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
    const { relativePath } = codexRolloutSessionPath(rollout);

    const workspace = await getWorkspaceForMember(workspaceId, user.id);
    if (!workspace) {
      return apiError(new Error("Workspace not found."), 404);
    }
    const session = await ensureOrcaSession(workspace, user.id);
    if (session.state !== "ready") {
      return apiError(
        new Error(
          "This workspace is still starting up. Try the import again in a moment.",
        ),
        503,
      );
    }

    for (const sessionsRoot of [
      ".codex/sessions",
      `.codev/agents/${user.id}/sessions`,
    ]) {
      await writeIdeFile(workspaceId, {
        path: `${sessionsRoot}/${relativePath}`,
        contents,
        root: "home",
      });
    }

    return Response.json({
      sessionId: rollout.sessionId,
      resumeCommand: `codex resume ${rollout.sessionId}`,
    });
  } catch (error) {
    if (error instanceof InvalidCodexRolloutError) {
      return apiError(error, 400);
    }
    if (error instanceof OrcaHostError) {
      return apiError(error, error.status);
    }
    return apiError(error);
  }
}
