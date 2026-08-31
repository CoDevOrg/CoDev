// CoDev-only. Projects the live agent-status map the sidebar already consumes
// into "which agent is editing which file, right now" — the signal the embedded
// editor paints as per-agent presence so a room full of people watches several
// agents write in parallel.
//
// Pure and time-parameterised: callers pass `now` and a TTL so a React tick can
// expire stale presence without a stateful store. `deriveCodevLiveEdit` does the
// per-entry extraction; this module is the fan-out, recency filter, and the
// per-file / per-worktree groupings the UI asks for.

import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import {
  deriveCodevLiveEdit,
  type CodevLiveEdit,
} from '../../../shared/codev-live-edit'

// Why: a file write ping resets `updatedAt`, so anything within this window is a
// currently-active author; past it the agent has moved on and the marker clears.
// Long enough to bridge a slow multi-file turn, short enough that a finished
// agent's cursor does not linger.
export const CODEV_LIVE_EDIT_TTL_MS = 12_000

export type CodevAgentFilePresence = CodevLiveEdit & {
  /** ms until this presence expires at the `now` it was projected for. */
  expiresInMs: number
}

/**
 * All agents with a fresh file edit, newest first, one row per pane (a pane only
 * ever authors one file at a time). `now` and `ttlMs` decide freshness.
 */
export function selectCodevLiveEdits(
  agentStatusByPaneKey: Readonly<Record<string, AgentStatusEntry>>,
  now: number,
  ttlMs: number = CODEV_LIVE_EDIT_TTL_MS,
): CodevAgentFilePresence[] {
  const rows: CodevAgentFilePresence[] = []
  for (const entry of Object.values(agentStatusByPaneKey)) {
    const age = now - entry.updatedAt
    if (!Number.isFinite(age) || age < 0 || age > ttlMs) {
      continue
    }
    const edit = deriveCodevLiveEdit({
      paneKey: entry.paneKey,
      worktreeId: entry.worktreeId,
      agentKind: entry.agentType,
      toolName: entry.toolName,
      toolInput: entry.toolInput,
      now: entry.updatedAt,
    })
    if (!edit) {
      continue
    }
    rows.push({ ...edit, expiresInMs: ttlMs - age })
  }
  return rows.sort((a, b) => b.at - a.at)
}

/** Agents live in one file of one worktree — what the open editor overlays. */
export function codevLiveEditsForFile(
  presence: readonly CodevAgentFilePresence[],
  worktreeId: string,
  filePath: string,
): CodevAgentFilePresence[] {
  return presence.filter(
    (row) => row.worktreeId === worktreeId && row.filePath === filePath,
  )
}

/** `worktreeId -> filePath -> agents`, for the sidebar's per-worktree rollup. */
export function codevLiveEditsByWorktree(
  presence: readonly CodevAgentFilePresence[],
): Map<string, Map<string, CodevAgentFilePresence[]>> {
  const byWorktree = new Map<string, Map<string, CodevAgentFilePresence[]>>()
  for (const row of presence) {
    let byFile = byWorktree.get(row.worktreeId)
    if (!byFile) {
      byFile = new Map<string, CodevAgentFilePresence[]>()
      byWorktree.set(row.worktreeId, byFile)
    }
    const bucket = byFile.get(row.filePath)
    if (bucket) {
      bucket.push(row)
    } else {
      byFile.set(row.filePath, [row])
    }
  }
  return byWorktree
}

/** Stable, distinct accent per agent kind for cursors, chips, and tab dots.
 *  Known kinds get a fixed hue; the long tail hashes its kind to one. */
export function codevAgentPresenceColor(agentKind: string): string {
  const fixed: Record<string, string> = {
    'claude-code': 'oklch(0.72 0.15 145)', // green
    'claude-agent-teams': 'oklch(0.72 0.15 145)',
    codex: 'oklch(0.7 0.17 45)', // orange
    cursor: 'oklch(0.62 0.19 285)', // violet
    gemini: 'oklch(0.65 0.17 255)', // blue
    grok: 'oklch(0.55 0.02 260)', // graphite
    opencode: 'oklch(0.7 0.15 195)', // teal
  }
  if (agentKind in fixed) {
    return fixed[agentKind]!
  }
  let hash = 0
  for (let index = 0; index < agentKind.length; index++) {
    hash = (hash * 31 + agentKind.charCodeAt(index)) | 0
  }
  return `oklch(0.68 0.16 ${Math.abs(hash) % 360})`
}
