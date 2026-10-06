import "server-only";
import type { schema } from "@codev/db";
import type { getDatabase } from "../platform/database";
import { githubRequest, type RepositorySnapshotFile } from "../github/github";
import { ArmWorkflowIO } from "../runtime/arm-workflow-io";

type Entry = {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
};
type Workspace = typeof schema.gen2Workspaces.$inferSelect;

function validateTree(tree: { truncated: boolean; tree: Entry[] }) {
  if (tree.truncated)
    throw new Error("The repository tree is too large for a CoDev snapshot.");
  if (tree.tree.some((entry) => entry.type === "commit"))
    throw new Error("Private repository snapshots do not support submodules.");
  const files = tree.tree.filter((entry) => entry.type === "blob");
  if (files.length > 500)
    throw new Error("Private repository snapshots are limited to 500 files.");
  if (
    files.reduce((sum, entry) => sum + (entry.size ?? 0), 0) >
    3 * 1024 * 1024
  )
    throw new Error("Private repository snapshots are limited to 3 MiB.");
  for (const entry of files) {
    if (!["100644", "100755", "120000"].includes(entry.mode))
      throw new Error(`Unsupported Git mode for ${entry.path}.`);
    if (entry.size === undefined || entry.size < 0 || entry.size > 1024 * 1024)
      throw new Error(
        `Unsupported private repository file size for ${entry.path}.`,
      );
  }
  return files;
}

/** Fetch and write one file atomically; checkpoints never contain file contents. */
export async function initializeArmPrivateSource(
  workspace: Workspace,
  db: ReturnType<typeof getDatabase>,
  write: (file: RepositorySnapshotFile) => Promise<unknown>,
) {
  const tree = await ArmWorkflowIO.checkpoint("repository-tree", () =>
    githubRequest<{ truncated: boolean; tree: Entry[] }>(
      workspace.ownerId,
      `/repos/${workspace.repository}/git/trees/${encodeURIComponent(workspace.baseSha ?? "")}?recursive=1`,
      { database: db },
    ),
  );
  const files = validateTree(tree);
  for (const entry of files) {
    await ArmWorkflowIO.checkpoint("repository-file", async () => {
      const blob = await githubRequest<{ content: string; encoding: string }>(
        workspace.ownerId,
        `/repos/${workspace.repository}/git/blobs/${entry.sha}`,
        { database: db },
      );
      if (blob.encoding !== "base64")
        throw new Error("GitHub returned an unsupported repository blob.");
      const contentBase64 = blob.content.replace(/\s+/g, "");
      const bytes = Buffer.from(contentBase64, "base64").byteLength;
      if (bytes !== entry.size)
        throw new Error(
          "GitHub returned an inconsistent repository blob size.",
        );
      await write({
        path: entry.path,
        mode: entry.mode as RepositorySnapshotFile["mode"],
        contentBase64,
      });
      return bytes;
    });
  }
}
