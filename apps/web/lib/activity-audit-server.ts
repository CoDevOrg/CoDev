import "server-only";

import { listWorkspaceEvents } from "./audit";
import {
  toActivitySnapshot,
  type ActivityFilterKind,
  type ActivitySnapshot,
} from "./activity-audit-view";
import { displayMemberName } from "./shared-session-view";
import { listWorkspaceMembers } from "./workspaces";

export type ActivityViewer = {
  id: string;
  name: string;
};

export type ActivityAuditSnapshot = ActivitySnapshot & {
  viewer: ActivityViewer;
};

export async function loadActivityAuditSnapshot(
  workspaceId: string,
  user: { id: string; name?: string | null; githubLogin?: string },
  filter: { kind?: ActivityFilterKind; query?: string } = {},
): Promise<ActivityAuditSnapshot> {
  const [events, members] = await Promise.all([
    listWorkspaceEvents(workspaceId, user.id),
    listWorkspaceMembers(workspaceId),
  ]);
  const actors = Object.fromEntries(
    members.map((member) => [
      member.userId,
      displayMemberName(member.name, member.login),
    ]),
  );
  if (user.id && !actors[user.id]) {
    actors[user.id] = displayMemberName(user.name, user.githubLogin);
  }
  return {
    viewer: {
      id: user.id,
      name: displayMemberName(user.name, user.githubLogin),
    },
    ...toActivitySnapshot({
      events: events.map((event) => ({
        id: event.id,
        sequence: event.sequence,
        type: event.type,
        actorId: event.actorId,
        payload:
          event.payload && typeof event.payload === "object"
            ? (event.payload as Record<string, unknown>)
            : {},
        createdAt: event.createdAt,
      })),
      actors,
      filter,
    }),
  };
}
