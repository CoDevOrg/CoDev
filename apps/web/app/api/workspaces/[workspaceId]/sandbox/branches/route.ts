import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import { executeInSandbox } from "@/lib/orchestrator";
import { getWorkspaceForMember } from "@/lib/workspaces";
import { githubRequest } from "@/lib/github";

export const maxDuration = 60;

export async function GET(
  _request: Request,
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
    // 1. Fetch remote branches directly from GitHub if workspace is linked to a repository
    let remoteBranches: string[] = [];
    try {
      const workspace = await getWorkspaceForMember(workspaceId, user.id);
      if (workspace?.repository) {
        const ghBranches = await githubRequest<{ name: string }[]>(
          user.id,
          `/repos/${workspace.repository}/branches?per_page=100`,
        );
        remoteBranches = ghBranches.map((b) => b.name);
      }
    } catch {
      // Fallback silently if GitHub API is unavailable or unauthenticated
    }

    // 2. List all local and remote branches in the sandbox
    let sandboxBranches: string[] = [];
    try {
      const result = await executeInSandbox(workspaceId, {
        command: ["git", "branch", "-a", "--format=%(refname:short)"],
        timeoutSeconds: 15,
      });

      sandboxBranches = result.output
        .split("\n")
        .map((b) => b.trim())
        .filter(Boolean)
        .filter((b) => !b.endsWith("/HEAD"))
        .map((b) => (b.startsWith("origin/") ? b.replace("origin/", "") : b));
    } catch {
      // Fallback silently if sandbox is offline
    }

    // Merge and deduplicate branches from both GitHub and sandbox
    const branches = Array.from(
      new Set([...remoteBranches, ...sandboxBranches]),
    );

    // Get the currently checked-out branch in sandbox
    let currentBranch = "main";
    try {
      const headResult = await executeInSandbox(workspaceId, {
        command: ["git", "symbolic-ref", "--short", "HEAD"],
        timeoutSeconds: 10,
      });
      const rawCurrent = headResult.output.trim();
      if (
        headResult.exitCode === 0 &&
        rawCurrent &&
        !rawCurrent.includes("fatal:") &&
        !rawCurrent.includes("error:")
      ) {
        currentBranch = rawCurrent;
      }
    } catch {
      // Keep default "main"
    }

    return Response.json({ branches, currentBranch });
  } catch (error) {
    return apiError(error);
  }
}
