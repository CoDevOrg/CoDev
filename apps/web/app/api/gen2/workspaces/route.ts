import { withUser, readJson } from "@/lib/http/api-route";
import {
  createGen2Workspace,
  listGen2WorkspacesForUser,
} from "@/lib/gen2/workspaces";
import { gen2WorkspaceCreateRequestSchema } from "@codev/contracts";

export const GET = withUser(
  async ({ user }) =>
    Response.json({ workspaces: await listGen2WorkspacesForUser(user.id) }),
  { errorStatus: 500 },
);

export const POST = withUser(
  async ({ request, user }) => {
    const input = await readJson(request, gen2WorkspaceCreateRequestSchema);
    const workspace = await createGen2Workspace(
      user.id,
      input.name,
      input.installationId && input.repositoryId
        ? {
            installationId: input.installationId,
            repositoryId: input.repositoryId,
          }
        : undefined,
    );
    return Response.json({ workspace }, { status: 201 });
  },
  { errorStatus: 500 },
);
