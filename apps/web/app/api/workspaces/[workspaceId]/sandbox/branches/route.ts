import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import { executeInSandbox } from "@/lib/orchestrator";

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
    // List all local and remote branches
    const result = await executeInSandbox(workspaceId, {
      command: ["git", "branch", "-a", "--format=%(refname:short)"],
      timeoutSeconds: 15,
    });

    const branches = result.output
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean)
      // Normalize remote refs: "origin/main" stays, "origin/HEAD" is removed
      .filter((b) => !b.endsWith("/HEAD"))
      // Deduplicate: strip "origin/" prefix for display comparison
      .reduce<string[]>((acc, b) => {
        if (!acc.includes(b)) acc.push(b);
        return acc;
      }, []);

    // Get the currently checked-out branch
    const headResult = await executeInSandbox(workspaceId, {
      command: ["git", "symbolic-ref", "--short", "HEAD"],
      timeoutSeconds: 10,
    });
    const currentBranch = headResult.output.trim();

    return Response.json({ branches, currentBranch });
  } catch (error) {
    return apiError(error);
  }
}
