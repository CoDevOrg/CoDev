import { z } from "zod";

import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import {
  getWorkspaceSnapshot,
  listSnapshotFiles,
  readSnapshotFile,
} from "@/lib/hibernation";
import {
  getSandboxGitOutput,
  listSandboxFiles,
  readSandboxFile,
  searchSandboxFiles,
  writeSandboxFile,
} from "@/lib/orchestrator";
import { attachGitStatus, parseFileList, parseSearchMatches } from "@/lib/ide";
import { getWorkspaceRuntime } from "@/lib/workspaces";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime-resume";

export const runtime = "nodejs";

const readSchema = z.object({ path: z.string().min(1).max(4_096) });
const writeSchema = readSchema.extend({
  contents: z.string().max(2 * 1_024 * 1_024),
  expectedRevision: z.string().min(1),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 403,
    );
  }

  try {
    const runtime = await getWorkspaceRuntime(workspaceId);
    const snapshot =
      runtime?.status === "hibernated"
        ? await getWorkspaceSnapshot(workspaceId)
        : null;
    const query = new URL(request.url).searchParams.get("query")?.trim();
    if (query) {
      if (query.length > 200) {
        return apiError(new Error("Search query is too long."), 400);
      }
      if (snapshot) {
        const needle = query.toLowerCase();
        const matches = snapshot.snapshot.files.flatMap((file) => {
          const contents = Buffer.from(file.contentBase64, "base64").toString(
            "utf8",
          );
          return contents
            .split("\n")
            .flatMap((line, index) =>
              line.toLowerCase().includes(needle)
                ? [{ path: file.path, line: index + 1, preview: line.trim() }]
                : [],
            );
        });
        return Response.json({ matches: matches.slice(0, 200) });
      }
      const output = await searchSandboxFiles(workspaceId, query);
      return Response.json({ matches: parseSearchMatches(output) });
    }
    if (snapshot) {
      return Response.json({ files: listSnapshotFiles(snapshot) });
    }
    const [files, status] = await Promise.all([
      listSandboxFiles(workspaceId),
      getSandboxGitOutput(workspaceId, "status"),
    ]);
    return Response.json({
      files: attachGitStatus(parseFileList(files), status),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 403,
    );
  }

  try {
    const input = readSchema.parse(await request.json());
    const runtime = await getWorkspaceRuntime(workspaceId);
    if (runtime?.status === "hibernated") {
      const snapshot = await getWorkspaceSnapshot(workspaceId);
      const file = snapshot ? readSnapshotFile(snapshot, input.path) : null;
      if (!file) return apiError(new Error("Workspace file not found."), 404);
      return Response.json({ file });
    }
    const file = await readSandboxFile(workspaceId, input.path);
    return Response.json({ file });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(
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
    const input = writeSchema.parse(await request.json());
    await ensureWorkspaceRuntimeReady(workspaceId, user.id);
    const result = await writeSandboxFile(workspaceId, input);
    return Response.json(result);
  } catch (error) {
    return apiError(error);
  }
}
