import "server-only";

import { presenceEventSchema, type PresenceEvent } from "@codev/contracts";

import { appendWorkspaceEvent } from "./audit";

export type PresenceEventInput = {
  workspaceId: string;
  type: PresenceEvent["type"];
  data: PresenceEvent["data"];
};

/**
 * Persist a typed presence transition in the ordered workspace event stream.
 * The audit table owns the sequence and timestamp; parsing the returned row
 * keeps the durable event shape identical across server and replay clients.
 */
export async function appendPresenceEvent(input: PresenceEventInput) {
  const persisted = await appendWorkspaceEvent({
    workspaceId: input.workspaceId,
    actorId: input.data.userId,
    type: input.type,
    payload: input.data,
  });
  if (!persisted) throw new Error("Presence event was not persisted.");

  return presenceEventSchema.parse({
    ...input,
    id: persisted.id,
    sequence: persisted.sequence,
    createdAt: persisted.createdAt.toISOString(),
  });
}
