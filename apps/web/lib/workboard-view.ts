import {
  MAX_PARALLEL_AGENT_SESSIONS,
  type AgentCapacity,
} from "@codev/contracts";

import {
  AGENT_CAPACITY_EXCEEDED_MESSAGE,
  summarizeAgentCapacity,
} from "./agent-capacity";
import { displayMemberName } from "./shared-session-view";

export const FOURTH_SESSION_REJECTION_TITLE =
  "Server rejected the fourth session · HTTP 409";

export type WorkboardTurn = {
  prompt: string;
  status: string;
};

export type WorkboardSession = {
  id: string;
  name: string;
  provider: string;
  status: string;
  worktreeId: string;
  worktreeName: string;
  worktreeStatus: string;
  ownerName?: string | null;
  ownerLogin?: string | null;
  issueTitle?: string | null;
  createdAt: Date | string;
  turns: WorkboardTurn[];
};

export type WorkboardSlot = {
  slot: 1 | 2 | 3;
  occupied: boolean;
  sessionId: string | null;
  worktreeId: string | null;
  assignment: string;
  owner: string;
  provider: string;
  status: string;
  worktree: string;
  currentTask: string;
  elapsed: string;
};

export type WorkboardRejection = {
  status: 409;
  title: string;
  message: string;
};

export type WorkboardViewer = {
  id: string;
  name: string;
  canCoSteer: boolean;
};

export type WorkboardSnapshot = {
  viewer: WorkboardViewer;
  capacity: AgentCapacity;
  slots: WorkboardSlot[];
  rejection: WorkboardRejection | null;
};

function isoDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

export function formatElapsed(startedAt: Date | string, now: Date) {
  const started = isoDate(startedAt);
  const seconds = Number.isNaN(started.getTime())
    ? 0
    : Math.max(0, Math.floor((now.getTime() - started.getTime()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function slotStatus(session: WorkboardSession) {
  if (session.worktreeStatus === "frozen") return "Frozen";
  if (session.status === "interrupted") return "Interrupted";
  if (session.status === "running") return "Running";
  return "Active";
}

function currentTask(session: WorkboardSession) {
  const latest = session.turns.at(-1)?.prompt.trim();
  return latest || "Awaiting instruction";
}

function emptySlot(slot: 1 | 2 | 3): WorkboardSlot {
  return {
    slot,
    occupied: false,
    sessionId: null,
    worktreeId: null,
    assignment: "Available",
    owner: "Unassigned",
    provider: "—",
    status: "Available",
    worktree: "No worktree",
    currentTask: "Start an agent session to fill this slot.",
    elapsed: "00:00",
  };
}

function occupiedSlot(
  slot: 1 | 2 | 3,
  session: WorkboardSession,
  now: Date,
): WorkboardSlot {
  return {
    slot,
    occupied: true,
    sessionId: session.id,
    worktreeId: session.worktreeId,
    assignment: session.issueTitle?.trim() || session.name,
    owner: displayMemberName(session.ownerName, session.ownerLogin),
    provider: session.provider,
    status: slotStatus(session),
    worktree: session.worktreeName,
    currentTask: currentTask(session),
    elapsed: formatElapsed(session.createdAt, now),
  };
}

export function toWorkboardSlots(
  sessions: WorkboardSession[],
  now = new Date(),
): { capacity: AgentCapacity; slots: WorkboardSlot[] } {
  const capacity = summarizeAgentCapacity(sessions);
  const active = sessions.filter(
    (session) =>
      session.worktreeStatus === "active" ||
      session.worktreeStatus === "frozen",
  );
  const slots: WorkboardSlot[] = [];
  for (let index = 0; index < MAX_PARALLEL_AGENT_SESSIONS; index += 1) {
    const slot = (index + 1) as 1 | 2 | 3;
    const session = active[index];
    slots.push(session ? occupiedSlot(slot, session, now) : emptySlot(slot));
  }
  return { capacity, slots };
}

export function workboardRejection(): WorkboardRejection {
  return {
    status: 409,
    title: FOURTH_SESSION_REJECTION_TITLE,
    message: AGENT_CAPACITY_EXCEEDED_MESSAGE,
  };
}
