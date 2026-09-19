import { toast } from 'sonner'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { useAppStore } from '@/store'
import type { TuiAgent } from '../../../shared/types'
import { isCodevEmbedded } from './codev-embedded'
import { requestCodevBridge } from './codev-bridge-singleton'
import { openCodevManagedAgentWorktree } from './codev-proposal-discard'

export type CodevManagedAgentProvider =
  | 'openai'
  | 'anthropic'
  | 'cursor'
  | 'bedrock'
  | 'azure_foundry'

type ManagedAgentSnapshot = {
  created?: { sessionId: string; worktreeId: string } | null
  rejection?: { message: string } | null
}

export type StartCodevManagedAgentOptions = {
  agent?: TuiAgent
  provider?: CodevManagedAgentProvider
  prompt?: string
  baseWorktreeId?: string | null
  repoId?: string | null
}

/** Translate Orca's provider labels into CoDev's backend provider contract. */
export function codevProviderForAgent(agent: TuiAgent): CodevManagedAgentProvider | null {
  if (agent === 'claude' || agent === 'claude-agent-teams') {
    return 'anthropic'
  }
  if (agent === 'codex') {
    return 'openai'
  }
  return null
}

function repoIdForWorktree(
  worktreeId: string | null,
  worktreesByRepo: Record<string, { id: string }[]>
): string | null {
  if (!worktreeId) {
    return null
  }
  for (const [repoId, worktrees] of Object.entries(worktreesByRepo)) {
    if (worktrees.some((worktree) => worktree.id === worktreeId)) {
      return repoId
    }
  }
  return null
}

/**
 * Starts the one CoDev agent product surface and opens its Orca control
 * worktree. The worktree is deliberately created with setup skipped: it is
 * not the backend sandbox checkout, only the IDE-side place to inspect and
 * review the managed session.
 */
export async function startCodevManagedAgent(
  options: StartCodevManagedAgentOptions = {}
): Promise<{ sessionId: string; worktreeId: string; orcaWorktreeId: string }> {
  if (!isCodevEmbedded()) {
    throw new Error('CoDev agents are only available in the embedded workspace.')
  }

  const provider =
    options.provider ?? (options.agent ? codevProviderForAgent(options.agent) : undefined)
  if (options.agent && !provider) {
    throw new Error('This provider is not available for the CoDev agent. Choose Claude or Codex.')
  }

  const requestParams = {
    name: 'CoDev agent',
    ...(provider ? { provider } : {}),
    ...(options.prompt?.trim() ? { prompt: options.prompt.trim() } : {})
  }
  const result = await requestCodevBridge<ManagedAgentSnapshot>('workboard.create', requestParams)
  if (result.rejection) {
    throw new Error(result.rejection.message)
  }
  if (!result.created) {
    throw new Error('CoDev did not return a managed agent session.')
  }

  const store = useAppStore.getState()
  const sourceWorktreeId = options.baseWorktreeId ?? store.activeWorktreeId
  const repoId = options.repoId ?? repoIdForWorktree(sourceWorktreeId, store.worktreesByRepo)
  let orcaWorktreeId: string
  try {
    orcaWorktreeId = await openCodevManagedAgentWorktree(result.created.worktreeId, {
      repoId,
      createWorktree: (
        nextRepoId,
        name,
        baseBranch,
        setupDecision,
        sparseCheckout,
        telemetrySource,
        displayName
      ) =>
        store.createWorktree(
          nextRepoId,
          name,
          baseBranch,
          setupDecision,
          sparseCheckout,
          telemetrySource,
          displayName
        ),
      updateComment: async (id, comment) => {
        await store.updateWorktreeMeta(id, { comment })
      }
    })
  } catch (error: unknown) {
    // The server reservation is created before Orca can create/tag its local
    // representation. Release it through the normal audited stop lifecycle
    // so a local failure cannot strand an active managed slot.
    await requestCodevBridge('agents.discard', {
      sessionId: result.created.sessionId
    }).catch(() => undefined)
    throw error
  }

  activateAndRevealWorktree(orcaWorktreeId, { sidebarRevealBehavior: 'auto' })
  store.setRightSidebarTab('codev-agents')
  store.setRightSidebarOpen(true)
  return {
    sessionId: result.created.sessionId,
    worktreeId: result.created.worktreeId,
    orcaWorktreeId
  }
}

export async function startCodevManagedAgentWithToast(
  options: StartCodevManagedAgentOptions = {}
): Promise<void> {
  try {
    await startCodevManagedAgent(options)
    toast.success('CoDev agent ready', {
      description: options.prompt?.trim()
        ? 'The agent is working in its managed sandbox. Orca is ready for steering and review.'
        : 'Open Agents to queue its first instruction.'
    })
  } catch (error: unknown) {
    toast.error('Could not start CoDev agent', {
      description: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
}
