import { parsePaneKey } from '../../../shared/stable-pane-id'

/** The Mission Control fields the stop decision actually reads. */
export type StoppableAgent = {
  key: string
  origin: 'you' | 'managed'
  sessionId: string | null
  worktreeId: string | null
}

export type AgentStopPlan =
  /** Server-owned session; the host decides whether the worktree goes too. */
  | { kind: 'discard-session'; sessionId: string }
  /** Retire this agent's tab and leave the checkout to its siblings. */
  | { kind: 'close-tab'; tabId: string; siblingCount: number }
  /** Last agent out: release the worktree and settle on one of these. */
  | { kind: 'release-worktree'; worktreeId: string; survivorWorktreeIds: string[] }
  | { kind: 'unsupported' }

const LOCAL_KEY_PREFIX = 'local:'

/**
 * Stopping an agent must not stop its neighbours. A reopened or fresh chat
 * runs in the worktree its transcript belongs to, so one checkout routinely
 * hosts several agents; only the last one out releases it.
 */
export function planAgentStop(key: string, agents: StoppableAgent[]): AgentStopPlan {
  const agent = agents.find((candidate) => candidate.key === key)
  if (!agent) {
    return { kind: 'unsupported' }
  }
  if (agent.origin === 'managed' && agent.sessionId) {
    return { kind: 'discard-session', sessionId: agent.sessionId }
  }
  if (!agent.worktreeId) {
    return { kind: 'unsupported' }
  }
  const others = agents.filter((candidate) => candidate.key !== agent.key)
  const siblings = others.filter((candidate) => candidate.worktreeId === agent.worktreeId)
  if (siblings.length > 0) {
    const tabId = key.startsWith(LOCAL_KEY_PREFIX)
      ? parsePaneKey(key.slice(LOCAL_KEY_PREFIX.length))?.tabId
      : null
    return tabId
      ? { kind: 'close-tab', tabId, siblingCount: siblings.length }
      : { kind: 'unsupported' }
  }
  return {
    kind: 'release-worktree',
    worktreeId: agent.worktreeId,
    survivorWorktreeIds: others
      .map((candidate) => candidate.worktreeId)
      .filter((id): id is string => Boolean(id))
  }
}
