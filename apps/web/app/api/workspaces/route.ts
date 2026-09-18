import { withUser } from "@/lib/api-route";
import { createWorkspace, listWorkspacesForUser } from "@/lib/workspaces";
import { workspaceCreateRequestSchema } from "@/lib/workspace-creation";

export const GET = withUser(
  async ({ user }) =>
    Response.json({ workspaces: await listWorkspacesForUser(user.id) }),
  // This handler had no catch; unexpected failures stay 500s.
  { anyAuth: true, errorStatus: 500 },
);

// QuotaError answers with its own 429.
export const POST = withUser(
  async ({ request, user }) => {
    const input = workspaceCreateRequestSchema.parse(await request.json());
    const workspace = await createWorkspace(
      user.id,
      input.installationId,
      input.repositoryId,
    );
    return Response.json({ workspace: { id: workspace.id } }, { status: 201 });
  },
  { anyAuth: true },
);
