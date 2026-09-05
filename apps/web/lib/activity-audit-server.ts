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
  /** Sequence to pass as the next page's `beforeSequence`, or null once the
   *  page came back short of `limit` — there is nothing older left to load. */
  nextCursor: number | null;
};

const DEFAULT_ACTIVITY_PAGE_SIZE = 100;

export async function loadActivityAuditSnapshot(
  workspaceId: string,
  user: { id: string; name?: string | null; githubLogin?: string },
  filter: {
    kind?: ActivityFilterKind;
    query?: string;
    limit?: number;
    beforeSequence?: number;
  } = {},
): Promise<ActivityAuditSnapshot> {
  const limit = filter.limit ?? DEFAULT_ACTIVITY_PAGE_SIZE;
  const [events, members] = await Promise.all([
    listWorkspaceEvents(workspaceId, user.id, limit, filter.beforeSequence),
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
  const nextCursor =
    events.length === limit ? (events.at(-1)?.sequence ?? null) : null;
  return {
    viewer: {
      id: user.id,
      name: displayMemberName(user.name, user.githubLogin),
    },
    nextCursor,
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
