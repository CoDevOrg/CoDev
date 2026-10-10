import "server-only";
import type { Gen2HomeSnapshot } from "@codev/contracts";

import { getOwnerComputeSummary } from "./compute-summary";
import { listGen2WorkspacesForUser } from "./workspaces";

/**
 * The member's workspaces and compute usage, read together so the home page's
 * counts never disagree with its cards. Database reads only: polling this must
 * never wake a guest or count as workspace activity.
 */
export async function getGen2HomeSnapshot(
  userId: string,
): Promise<Gen2HomeSnapshot> {
  const [workspaces, compute] = await Promise.all([
    listGen2WorkspacesForUser(userId),
    getOwnerComputeSummary(userId),
  ]);
  return { workspaces, compute };
}
