import { githubRequest } from "./github";

export interface RepositoryTreeNode {
  path: string;
  type: "blob" | "tree" | "commit";
  size?: number;
}

/**
 * The committed file and folder names at one revision. This does not download
 * file contents, and it does not apply the private-snapshot size cap.
 */
export async function listRepositoryTree(
  userId: string,
  repository: string,
  commitSha: string,
): Promise<RepositoryTreeNode[]> {
  const tree = await githubRequest<{
    truncated: boolean;
    tree: RepositoryTreeNode[];
  }>(
    userId,
    `/repos/${repository}/git/trees/${encodeURIComponent(commitSha)}?recursive=1`,
  );
  return tree.tree;
}
