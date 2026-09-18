import { MAX_PARALLEL_AGENT_SESSIONS } from "@codev/contracts";

export const LIVE_AGENT_ACTIVITY_POLL_MS = 4_000;

export type LiveAgentSlot = {
  slot: 1 | 2 | 3;
  occupied: boolean;
  sessionId: string | null;
  assignment: string;
  owner: string;
  provider: string;
  status: string;
  currentTask: string;
  elapsed: string;
};

export type LiveAgentContributor = {
  session: { sessionId: string };
  ownerName: string;
  activeTurnAuthorName: string | null;
  attributedQueue: Array<{ authorName: string }>;
  transcript: Array<{ authorName: string }>;
};

export type LiveAgentActivityCard = {
  slot: 1 | 2 | 3;
  occupied: boolean;
  assignment: string;
  status: string;
  provider: string;
  owner: string;
  working: string[];
  currentTask: string;
  elapsed: string;
};

export type LiveAgentActivitySnapshot = {
  cards: LiveAgentActivityCard[];
  occupied: number;
  max: number;
};

function emptySlot(slot: 1 | 2 | 3): LiveAgentSlot {
  return {
    slot,
    occupied: false,
    sessionId: null,
    assignment: "Available",
    owner: "Unassigned",
    provider: "—",
    status: "Available",
    currentTask: "Start an agent session to fill this slot.",
    elapsed: "00:00",
  };
}

function uniqueNames(values: Array<string | null | undefined>) {
  const names: string[] = [];
  for (const value of values) {
    const name = value?.trim();
    if (name && name !== "Unassigned" && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

function workingNames(
  slot: LiveAgentSlot,
  session: LiveAgentContributor | undefined,
) {
  if (!slot.occupied) return [];
  return uniqueNames([
    session?.activeTurnAuthorName,
    ...(session?.attributedQueue.map((entry) => entry.authorName) ?? []),
    ...(session?.transcript.map((turn) => turn.authorName) ?? []),
    session?.ownerName,
    slot.owner,
  ]);
}

function toCard(
  slot: LiveAgentSlot,
  session: LiveAgentContributor | undefined,
): LiveAgentActivityCard {
  return {
    slot: slot.slot,
    occupied: slot.occupied,
    assignment: slot.assignment,
    status: slot.status,
    provider: slot.provider,
    owner: slot.owner,
    working: workingNames(slot, session),
    currentTask: slot.currentTask,
    elapsed: slot.elapsed,
  };
}

export function emptyLiveAgentCards(): LiveAgentActivityCard[] {
  return [1, 2, 3].map((slot) =>
    toCard(emptySlot(slot as 1 | 2 | 3), undefined),
  );
}

export function toLiveAgentActivity(
  slots: LiveAgentSlot[],
  sharedSessions: LiveAgentContributor[],
): LiveAgentActivityCard[] {
  const bySessionId = new Map(
    sharedSessions.map((session) => [session.session.sessionId, session]),
  );
  return emptyLiveAgentCards().map((placeholder, index) => {
    const slot = slots[index];
    if (!slot) return placeholder;
    return toCard(
      slot,
      slot.sessionId ? bySessionId.get(slot.sessionId) : undefined,
    );
  });
}

export function liveAgentActivityFromPayloads(
  workboard: {
    slots?: LiveAgentSlot[];
    capacity?: { activeSessions?: number; maxActiveSessions?: number };
  },
  shared: { sharedSessions?: LiveAgentContributor[] } | null,
): LiveAgentActivitySnapshot {
  const slots = Array.isArray(workboard.slots) ? workboard.slots : [];
  const sharedSessions = Array.isArray(shared?.sharedSessions)
    ? shared.sharedSessions
    : [];
  const cards = toLiveAgentActivity(slots, sharedSessions);
  return {
    cards,
    occupied:
      workboard.capacity?.activeSessions ??
      cards.filter((card) => card.occupied).length,
    max: workboard.capacity?.maxActiveSessions ?? MAX_PARALLEL_AGENT_SESSIONS,
  };
}

export async function fetchLiveAgentActivity(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<LiveAgentActivitySnapshot> {
  const [workboardResponse, sharedResponse] = await Promise.all([
    fetcher(`/api/workspaces/${workspaceId}/agents/workboard`, {
      cache: "no-store",
    }),
    fetcher(`/api/workspaces/${workspaceId}/agents/shared`, {
      cache: "no-store",
    }),
  ]);
  if (!workboardResponse.ok) {
    throw new Error("CoDev could not load active agents.");
  }
  const workboard = (await workboardResponse.json()) as {
    slots?: LiveAgentSlot[];
    capacity?: { activeSessions?: number; maxActiveSessions?: number };
  };
  const shared = sharedResponse.ok
    ? ((await sharedResponse.json()) as {
        sharedSessions?: LiveAgentContributor[];
      })
    : null;
  return liveAgentActivityFromPayloads(workboard, shared);
}
