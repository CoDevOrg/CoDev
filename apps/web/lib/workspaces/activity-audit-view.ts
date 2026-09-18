export type ActivityJumpKind = "file" | "session" | "diff";

export type ActivityJump = {
  kind: ActivityJumpKind;
  surface: "explorer" | "vault" | "checks";
  label: string;
  path: string | null;
  sessionId: string | null;
};

export type ActivityFilterKind = "all" | "file" | "session" | "diff";

export type ActivityEventRecord = {
  id: string;
  sequence: number;
  type: string;
  actorId?: string | null;
  payload?: Record<string, unknown> | null;
  createdAt: Date | string;
};

export type ActivityEvent = {
  id: string;
  sequence: number;
  type: string;
  actorId: string | null;
  actor: string;
  summary: string;
  createdAt: string;
  path: string | null;
  sessionId: string | null;
  jump: ActivityJump | null;
  /** The revision a "restore workspace to this point" action would reset the
   *  integration worktree to, when this event has one. */
  restoreRevision: string | null;
};

export type ActivitySnapshot = {
  events: ActivityEvent[];
  filters: { kind: ActivityFilterKind; query: string };
  filtered: ActivityEvent[];
};

const NOISE_TYPES = new Set(["presence.cursor.changed"]);

const TYPE_LABELS: Record<string, string> = {
  "agent.review_merged": "integrated a reviewed checkpoint",
  "agent.review_discarded": "discarded a proposal",
  "agent.session_stopped": "stopped an agent",
  "presence.joined": "joined the workspace",
  "presence.left": "left the workspace",
  "presence.active_file.changed": "opened a file",
  "workspace.comment_added": "commented",
  "workspace.synced": "synced the workspace",
  "lifecycle.cleaned": "cleaned up the workspace",
  "publication.published": "published a branch",
  "publication.failed": "failed to publish a branch",
  "file.restored": "restored a file",
  "workspace.restored": "restored the workspace",
};

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

function stringField(
  payload: Record<string, unknown> | null | undefined,
  keys: string[],
) {
  if (!payload) return null;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function activityEventPath(
  payload: Record<string, unknown> | null | undefined,
) {
  return stringField(payload, ["path", "filePath", "activePath"]);
}

export function activityEventSessionId(
  payload: Record<string, unknown> | null | undefined,
) {
  return stringField(payload, ["sessionId"]);
}

/** Only a merged agent review carries a known-good prior revision (the
 *  integration head right before that merge) — every other event type has
 *  no well-defined "restore to this point" target. */
export function activityRestoreRevision(
  type: string,
  payload: Record<string, unknown> | null | undefined,
) {
  if (type !== "agent.review_merged") return null;
  return stringField(payload, ["reviewBaseSha"]);
}

export function activityJumpFor(
  type: string,
  payload: Record<string, unknown> | null | undefined,
): ActivityJump | null {
  const path = activityEventPath(payload);
  const sessionId = activityEventSessionId(payload);
  if (
    type === "agent.review_merged" ||
    type === "agent.review_discarded" ||
    type.startsWith("publication.")
  ) {
    return {
      kind: "diff",
      surface: "checks",
      label: path ? `Open Checks · ${path}` : "Open Checks · diff",
      path,
      sessionId,
    };
  }
  if (sessionId) {
    return {
      kind: "session",
      surface: "vault",
      label: "Open Agents · session",
      path,
      sessionId,
    };
  }
  if (path) {
    return {
      kind: "file",
      surface: "explorer",
      label: `Open Explorer · ${path}`,
      path,
      sessionId,
    };
  }
  return null;
}

export function activityEventSummary(
  type: string,
  actor: string,
  payload: Record<string, unknown> | null | undefined,
) {
  const path = activityEventPath(payload);
  const action = TYPE_LABELS[type];
  if (type === "presence.active_file.changed" && path) {
    return `${actor} opened ${path}`;
  }
  if (type === "workspace.comment_added" && path) {
    return `${actor} commented on ${path}`;
  }
  if (type === "file.restored" && path) {
    return `${actor} restored ${path}`;
  }
  if (action) return `${actor} ${action}`;
  return `${actor} · ${type}`;
}

export function isActivityNoiseType(type: string) {
  return NOISE_TYPES.has(type);
}

export function filterActivityEvents(
  events: ActivityEvent[],
  filter: { kind?: ActivityFilterKind; query?: string } = {},
) {
  const kind = filter.kind ?? "all";
  const query = filter.query?.trim().toLowerCase() ?? "";
  return events.filter((event) => {
    if (kind !== "all" && event.jump?.kind !== kind) return false;
    if (!query) return true;
    return (
      event.summary.toLowerCase().includes(query) ||
      event.type.toLowerCase().includes(query) ||
      event.actor.toLowerCase().includes(query) ||
      (event.path?.toLowerCase().includes(query) ?? false)
    );
  });
}

export function toActivitySnapshot(input: {
  events: ActivityEventRecord[];
  actors?: Record<string, string>;
  filter?: { kind?: ActivityFilterKind; query?: string };
}): ActivitySnapshot {
  const actors = input.actors ?? {};
  const events = input.events
    .filter((event) => !isActivityNoiseType(event.type))
    .map((event) => {
      const actorId = event.actorId ?? null;
      const actor =
        (actorId && actors[actorId]) ||
        (actorId ? `Member ${actorId.slice(0, 8)}` : "System");
      const payload =
        event.payload && typeof event.payload === "object"
          ? event.payload
          : null;
      return {
        id: event.id,
        sequence: event.sequence,
        type: event.type,
        actorId,
        actor,
        summary: activityEventSummary(event.type, actor, payload),
        createdAt: iso(event.createdAt),
        path: activityEventPath(payload),
        sessionId: activityEventSessionId(payload),
        jump: activityJumpFor(event.type, payload),
        restoreRevision: activityRestoreRevision(event.type, payload),
      } satisfies ActivityEvent;
    })
    .sort((left, right) => right.sequence - left.sequence);
  const kind = input.filter?.kind ?? "all";
  const query = input.filter?.query?.trim() ?? "";
  return {
    events,
    filters: { kind, query },
    filtered: filterActivityEvents(events, { kind, query }),
  };
}
