import { useCallback, useMemo, useState, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { History, MessageSquarePlus, Search } from 'lucide-react'
import { useAppStore } from '@/store'
import {
  useActiveRepo,
  useActiveWorktree,
  useActiveWorktreeId,
  useAllWorktrees,
  useProjectHostSetupProjection,
  useRepos
} from '@/store/selectors'
import { cn } from '@/lib/utils'
import { isCodevEmbedded } from '@/web/codev-embedded'
import { supersedeWorktreeAgentTabs } from '@/web/codev-retire-superseded-chat'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import { AI_VAULT_AGENTS } from '../../../../shared/ai-vault-types'
import { filterAiVaultSessions } from './ai-vault-session-filters'
import { deriveAiVaultScopeSessionPaths } from './ai-vault-scope-paths'
import {
  buildAiVaultProjectContext,
  buildAiVaultSessionProjectById
} from './ai-vault-session-projects'
import { useAiVaultSessionRefresh } from './ai-vault-session-refresh'
import { useAiVaultSessionLaunchActions } from './ai-vault-session-launch-actions'
import { useAiVaultExecutionHostScope } from './ai-vault-host-scope'
import { DEFAULT_AI_VAULT_SESSION_LIMIT } from './ai-vault-session-limit'
import {
  buildCodevChatHistoryEntries,
  formatChatHistoryAge,
  type CodevChatHistoryEntry
} from './codev-chat-history-entries'

/**
 * Chat history for the workspace's repository.
 *
 * CoDev replaces Orca's Agent Session History tab with a single Agents tab,
 * which shows what is running now. That left no way back into a conversation
 * a member had stepped out of — and no way to escape a thread that had grown
 * too long for the model to steer well, short of abandoning the agent.
 *
 * This section lists past chats from the *current project only* (scope
 * 'project', which the vault filter resolves against the active repo), newest
 * first, and resumes one on click through the same launch path the stock
 * panel uses. Every chat listed here belongs to a worktree that already
 * exists, so reopening one never touches agent capacity.
 */
export function CodevChatHistorySection({
  className,
  onNewChat,
  newChatPending = false,
  canStartNewChat = false
}: {
  className?: string
  onNewChat?: () => void
  newChatPending?: boolean
  canStartNewChat?: boolean
}): JSX.Element {
  const activeWorktree = useActiveWorktree()
  const activeWorktreeId = useActiveWorktreeId()
  const activeRepo = useActiveRepo()
  const repos = useRepos()
  const allWorktrees = useAllWorktrees()
  const projectHostSetupProjection = useProjectHostSetupProjection()
  const settings = useAppStore((state) => state.settings)
  const resumeTargetState = useAppStore(
    useShallow((state) => ({
      folderWorkspaces: state.folderWorkspaces,
      projectGroups: state.projectGroups,
      repos: state.repos,
      worktreesByRepo: state.worktreesByRepo
    }))
  )
  const [query, setQuery] = useState('')

  const projectScopeContext = useMemo(
    () =>
      buildAiVaultProjectContext({
        repos,
        worktrees: allWorktrees,
        projectHostSetupProjection,
        activeRepo,
        activeWorktree,
        sessions: []
      }),
    [activeRepo, activeWorktree, allWorktrees, projectHostSetupProjection, repos]
  )
  const activeProjectKey = projectScopeContext.activeProjectKey
  const scopePaths = useMemo(
    () =>
      deriveAiVaultScopeSessionPaths(activeWorktree ?? null, allWorktrees, {
        activeProjectKey,
        projectHostSetupProjection
      }),
    [activeProjectKey, activeWorktree, allWorktrees, projectHostSetupProjection]
  )
  const { executionHostScope } = useAiVaultExecutionHostScope({
    activeWorktreeId: activeWorktreeId ?? null,
    resumeTargetState
  })
  const { error, loading, sessions } = useAiVaultSessionRefresh(
    scopePaths,
    executionHostScope,
    DEFAULT_AI_VAULT_SESSION_LIMIT
  )
  const sessionProjectById = useMemo(
    () =>
      buildAiVaultSessionProjectById({
        repos,
        worktrees: allWorktrees,
        projectHostSetupProjection,
        sessions
      }),
    [allWorktrees, projectHostSetupProjection, repos, sessions]
  )
  const activeWorktreePaths = useMemo(
    () => (activeWorktree?.path ? [activeWorktree.path] : []),
    [activeWorktree?.path]
  )
  // Without an active project the vault cannot tell this repo's chats from any
  // other, and a list of unrelated conversations is worse than none.
  const scopedSessions = useMemo(
    () =>
      activeProjectKey
        ? filterAiVaultSessions(sessions, {
            query,
            agents: AI_VAULT_AGENTS,
            scope: 'project',
            sort: 'updated',
            activeWorktreePaths,
            activeProjectKey,
            sessionProjectById,
            projectLabelByKey: projectScopeContext.projectLabelByKey,
            hideEmptySessions: true
          })
        : [],
    [
      activeProjectKey,
      activeWorktreePaths,
      projectScopeContext.projectLabelByKey,
      query,
      sessionProjectById,
      sessions
    ]
  )
  const sessionById = useMemo(() => {
    const map = new Map<string, AiVaultSession>()
    for (const session of scopedSessions) {map.set(session.id, session)}
    return map
  }, [scopedSessions])
  const entries = useMemo(
    () => buildCodevChatHistoryEntries(scopedSessions),
    [scopedSessions]
  )

  const launchActions = useAiVaultSessionLaunchActions({
    activeWorktree: activeWorktree ?? null,
    activeWorktreeId: activeWorktreeId ?? activeWorktree?.id ?? null,
    targetState: resumeTargetState,
    agentCmdOverrides: settings?.agentCmdOverrides
  })
  const openChat = useCallback(
    (entry: CodevChatHistoryEntry) => {
      const session = sessionById.get(entry.id)
      if (!session) {
        return
      }
      // Reopening a chat resumes it in the worktree it belongs to. Without
      // this the idle agent already sitting in that worktree stays running
      // beside the new one, so reading an old conversation silently costs an
      // agent. Inside CoDev the worktree keeps one agent; stock Orca, where
      // parallel agents in a worktree are a normal thing to want, is untouched.
      // `handleResume` resolves the same target when no explicit worktree is
      // passed, which is the case here.
      const targetWorktreeId = activeWorktreeId ?? activeWorktree?.id ?? null
      const retire =
        isCodevEmbedded() && targetWorktreeId
          ? supersedeWorktreeAgentTabs(targetWorktreeId)
          : null
      launchActions.handleResume(session)
      retire?.()
    },
    [activeWorktree?.id, activeWorktreeId, launchActions, sessionById]
  )

  return (
    <section className={cn('codev-chat-history', className)} aria-label="Chat history">
      <header className="codev-chat-history-header">
        <div className="codev-chat-history-title">
          <History className="size-3.5 opacity-70" aria-hidden="true" />
          <h3>Chats</h3>
        </div>
        {onNewChat ? (
          <button
            type="button"
            className="codev-chat-history-new"
            onClick={onNewChat}
            disabled={!canStartNewChat || newChatPending}
            title={
              canStartNewChat
                ? 'Start a fresh chat on this agent, same branch and files'
                : 'Open an agent to start a fresh chat on it'
            }
          >
            <MessageSquarePlus className="size-3.5" aria-hidden="true" />
            {newChatPending ? 'Starting…' : 'New chat'}
          </button>
        ) : null}
      </header>

      <label className="codev-chat-history-search">
        <Search className="size-3.5 opacity-60" aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder="Search chats"
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search chats in this project"
        />
      </label>

      {error ? (
        <p className="codev-chat-history-empty">{error}</p>
      ) : entries.length === 0 ? (
        <p className="codev-chat-history-empty">
          {loading
            ? 'Looking for earlier chats…'
            : query
              ? 'No chat matches that search.'
              : 'No earlier chats in this project yet.'}
        </p>
      ) : (
        <ul className="codev-chat-history-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className={cn('codev-chat-history-row', entry.isLive && 'is-live')}
                onClick={() => openChat(entry)}
              >
                <span className="codev-chat-history-row-title">{entry.title}</span>
                <span className="codev-chat-history-row-meta">
                  <span>{entry.agent}</span>
                  {entry.branch ? <span>{entry.branch}</span> : null}
                  <span>{entry.messageCount} msgs</span>
                  <span>{formatChatHistoryAge(entry.modifiedAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
