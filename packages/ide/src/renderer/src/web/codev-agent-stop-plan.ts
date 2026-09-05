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
  /** End this agent alone and leave the checkout standing. */
  | { kind: 'close-tab'; tabId: string; siblingCount: number }
  /** Last agent out of a worktree CoDev made for it: release it, settle here. */
  | { kind: 'release-worktree'; worktreeId: string; survivorWorktreeIds: string[] }
  | { kind: 'unsupported' }

const LOCAL_KEY_PREFIX = 'local:'

/**
 * Stopping an agent must not stop its neighbours, and must not take the
 * workspace with it. A fresh or reopened chat runs in the worktree its
 * transcript belongs to, so one checkout routinely hosts several agents; and a
 * workspace with no repository has no agent worktree at all, only its own root.
 * So the checkout is released for exactly one agent: the last one out of a
 * worktree CoDev created to isolate it.
 */
export function planAgentStop(
  key: string,
  agents: StoppableAgent[],
  isReleasableWorktree: (worktreeId: string) => boolean
): AgentStopPlan {
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
  if (siblings.length === 0 && isReleasableWorktree(agent.worktreeId)) {
    return {
      kind: 'release-worktree',
      worktreeId: agent.worktreeId,
      survivorWorktreeIds: others
        .map((candidate) => candidate.worktreeId)
        .filter((id): id is string => Boolean(id))
    }
  }
  const tabId = key.startsWith(LOCAL_KEY_PREFIX)
    ? parsePaneKey(key.slice(LOCAL_KEY_PREFIX.length))?.tabId
    : null
  return tabId
    ? { kind: 'close-tab', tabId, siblingCount: siblings.length }
    : { kind: 'unsupported' }
}
