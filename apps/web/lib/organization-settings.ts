import "server-only";

import { listWorkspacesForUser } from "./workspaces";
import {
  requireOrganizationSettingsAccess,
  type OrganizationSettingsContext,
} from "./settings-access";

export async function getActiveOrganizationSettingsContext(
  userId: string,
): Promise<OrganizationSettingsContext | null> {
  const [workspace] = await listWorkspacesForUser(userId);
  if (!workspace) return null;

  const access = await requireOrganizationSettingsAccess(
    userId,
    workspace.id,
    "read",
  );

  return {
    ...access,
    workspace: {
      id: workspace.id,
      repository: workspace.repository,
      repositoryVisibility:
        workspace.repositoryVisibility === "private" ? "private" : "public",
      status: workspace.status,
    },
  };
}
