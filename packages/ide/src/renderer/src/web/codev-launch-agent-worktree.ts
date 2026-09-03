import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { resolveAgentLaunchStartup } from '@/lib/resolve-agent-launch-startup'
import { runBackgroundWorktreeCreation } from '@/lib/worktree-creation-flow'
import { tuiAgentToAgentKind } from '@/lib/telemetry'
import type { WorktreeCreationRequest } from '@/lib/pending-worktree-creation'
import type { TuiAgent } from '../../../shared/types'
import type { LaunchSource } from '../../../shared/telemetry-events'
import { isCodevEmbedded } from './codev-embedded'

const AGENT_WORKTREE_BRANCH_PREFIX = 'codev'

/**
 * `codev/<agent>-<8 hex>` and its `<agent>-<8 hex>` name half. The suffix keeps
 * both the branch and the worktree directory unique across concurrent agents,
 * and the shape passes the `git check-ref-format --branch` validation Orca
 * applies to `branchNameOverride` (orca-runtime.ts).
 */
export function deriveAgentWorktreeIdentity(agent: TuiAgent): {
  branchName: string
  name: string
} {
  const slug =
    agent
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'agent'
  const name = `${slug}-${createBrowserUuid().slice(0, 8)}`
  return { branchName: `${AGENT_WORKTREE_BRANCH_PREFIX}/${name}`, name }
}

/**
 * True when a worktree is one CoDev created to isolate an agent — the main
 * working tree never is, and a per-agent worktree is on a `codev/…` branch or
 * was stamped with the agent it was created for.
 */
export function isCodevAgentWorktree(worktree: {
  isMainWorktree?: boolean
  branch?: string
  createdWithAgent?: unknown
}): boolean {
  if (worktree.isMainWorktree) {
    return false
  }
  return (
    Boolean(worktree.createdWithAgent) ||
    (typeof worktree.branch === 'string' &&
      worktree.branch.startsWith(`${AGENT_WORKTREE_BRANCH_PREFIX}/`))
  )
}

export type LaunchCodevAgentInOwnWorktreeArgs = {
  agent: TuiAgent
  /** The worktree whose branch + repo the new worktree is based on — the
   *  workspace's current checkout. */
  baseWorktreeId: string
  prompt?: string
  promptDelivery?: 'auto-submit' | 'draft' | 'submit-after-ready'
  launchSource?: LaunchSource
}

/**
 * Create a fresh git worktree + branch off the workspace's current checkout and
 * launch `agent` in a chat tab there. This is how CoDev keeps every agent
 * isolated so two agents never edit the same tree; `codev-agent-worktree-automerge`
 * folds the branch back into the workspace branch when the agent goes idle and
 * the merge is clean.
 *
 * Returns the creationId, or null when no startup plan could be built or the
 * base worktree is unknown (the caller falls back to an in-place launch).
 */
export function launchCodevAgentInOwnWorktree(
  args: LaunchCodevAgentInOwnWorktreeArgs
): string | null {
  const { agent, baseWorktreeId, prompt, promptDelivery = 'auto-submit', launchSource } = args
  const store = useAppStore.getState()
  const base = store.allWorktrees?.().find((entry: { id: string }) => entry.id === baseWorktreeId)
  if (!base?.repoId) {
    // Why: both bail-outs used to be silent, so a workspace that never opened a
    // chat gave the console nothing to go on. The caller still falls back to an
    // in-place launch, so this stays a warning rather than a toast.
    console.warn('CoDev cannot isolate the agent: base worktree has no repo', { baseWorktreeId })
    return null
  }

  const { startupPlan } = resolveAgentLaunchStartup({
    agent,
    worktreeId: baseWorktreeId,
    ...(prompt !== undefined ? { prompt } : {}),
    promptDelivery
  })
  if (!startupPlan) {
    console.warn('CoDev cannot isolate the agent: no startup plan resolved', {
      agent,
      baseWorktreeId
    })
    return null
  }

  // Self-contained launch (no draft/followup paste) → let the host spawn the
  // agent as the worktree's first terminal, mirroring the composer.
  const backendStartup =
    !startupPlan.draftPrompt && !startupPlan.followupPrompt
      ? {
          command: startupPlan.launchCommand,
          ...(startupPlan.env ? { env: startupPlan.env } : {}),
          launchConfig: startupPlan.launchConfig,
          launchAgent: agent,
          ...(startupPlan.startupCommandDelivery
            ? { startupCommandDelivery: startupPlan.startupCommandDelivery }
            : {}),
          telemetry: {
            agent_kind: tuiAgentToAgentKind(agent),
            launch_source: launchSource ?? 'new_workspace_composer',
            request_kind: 'new' as const
          }
        }
      : undefined

  const { branchName, name } = deriveAgentWorktreeIdentity(agent)
  const baseBranch = base.branch?.trim() || undefined

  const request: WorktreeCreationRequest = {
    repoId: base.repoId,
    // CoDev's workspace host is always paired/remote, which emits no stepped
    // create progress.
    worktreeCreateProgressMode: 'indeterminate',
    name,
    setupDecision: 'inherit',
    ...(baseBranch ? { baseBranch } : {}),
    agent,
    branchNameOverride: branchName,
    // Rename the worktree from the agent's first message so the sidebar reads
    // like a task, not `claude-a1b2c3d4`.
    pendingFirstAgentMessageRename: true,
    note: '',
    ...(backendStartup ? { startup: backendStartup } : {}),
    startupPlan,
    quickPrompt: prompt?.trim() ?? '',
    quickTelemetry: null
  }

  try {
    return runBackgroundWorktreeCreation(request)
  } catch (error) {
    console.error('Failed to launch CoDev agent in its own worktree', error)
    toast.error('Could not start the agent in its own worktree')
    return null
  }
}

/**
 * For the "new agent" entry points (tab-bar quick launch, the `+` menu):
 * outside CoDev-embedded mode return null so the caller does its normal
 * in-place `launchAgentInNewTab`; inside it, isolate the agent in its own
 * worktree and return the creationId.
 */
export function maybeLaunchCodevAgentInOwnWorktree(
  args: LaunchCodevAgentInOwnWorktreeArgs
): string | null {
  if (!isCodevEmbedded()) {
    return null
  }
  return launchCodevAgentInOwnWorktree(args)
}
