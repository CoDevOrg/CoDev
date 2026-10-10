import "server-only";

import {
  gen2RealtimeEventSchema,
  type Gen2RealtimeActor,
  type Gen2RealtimeEvent,
  type Gen2WorkspaceMember,
} from "@codev/contracts";

import { logEvent } from "../platform/observability";
import { gen2CollaborationRoom } from "./collaboration-events";
import { publishStamped } from "./collaboration-rooms";

/** Leaves room under the socket's 128 KiB frame for the envelope. */
const MAX_EVENT_BYTES = 64 * 1_024;

function fitEvent(event: Gen2RealtimeEvent): Gen2RealtimeEvent | null {
  const parsed = gen2RealtimeEventSchema.parse(event);
  if (JSON.stringify(parsed).length <= MAX_EVENT_BYTES) return parsed;
  // A long reply still announces itself; members fetch the thread instead.
  if (parsed.kind === "chat.message") return { ...parsed, message: null };
  if (parsed.kind === "turn.settled") return { ...parsed, message: null };
  return null;
}

/**
 * Pushes a workspace change to every member's open tab. Call it after the
 * change commits. It never throws: realtime delivery is a convenience, and
 * the operation that caused it has already succeeded.
 */
export async function publishGen2WorkspaceEvent(
  workspaceId: string,
  event: Gen2RealtimeEvent,
) {
  try {
    const fitted = fitEvent(event);
    if (!fitted) {
      logEvent("warn", "gen2.realtime.event_too_large", { kind: event.kind });
      return;
    }
    const at = new Date().toISOString();
    await publishStamped(gen2CollaborationRoom(workspaceId), (streamId) => ({
      type: "event",
      event: fitted,
      streamId,
      at,
    }));
  } catch (error) {
    logEvent("warn", "gen2.realtime.publish_failed", {
      kind: event.kind,
      detail: error instanceof Error ? error.message : "unknown",
    });
  }
}

/** Tells file trees and change lists in `worktreeId` to refresh `paths`. */
export function publishGen2FilesChanged(
  workspaceId: string,
  worktreeId: string,
  paths: string[],
  actor: Gen2RealtimeActor,
) {
  const unique = [...new Set(paths)];
  return publishGen2WorkspaceEvent(workspaceId, {
    kind: "files.changed",
    worktreeId,
    paths: unique.slice(0, 200),
    truncated: unique.length > 200,
    actor,
  });
}

/** The live member list, without email addresses. */
export async function publishGen2MembersChanged(
  workspaceId: string,
  members: Gen2WorkspaceMember[] | null,
) {
  if (!members) return;
  await publishGen2WorkspaceEvent(workspaceId, {
    kind: "members.changed",
    members: members.map((member) => ({
      userId: member.userId,
      login: member.login,
      name: member.name,
      avatarUrl: member.avatarUrl ?? null,
      role: member.role,
      joinedAt: member.joinedAt,
    })),
  });
}
