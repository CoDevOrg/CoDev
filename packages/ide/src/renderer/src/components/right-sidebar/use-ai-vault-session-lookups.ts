import { useCallback } from 'react'
import { toast } from 'sonner'
import type { Repo, Worktree } from '../../../../shared/types'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import { translate } from '@/i18n/i18n'
import {
  resolveAiVaultSessionResumeActions,
  resolveAiVaultSessionResumeState,
  type AiVaultSessionResumeTargetState
} from './ai-vault-session-resume'
import type { AiVaultSessionWorktreeInfo } from './ai-vault-session-worktree'

export function useAiVaultSessionLookups(args: {
  effectiveActiveWorktreeId: string | null
  getSessionWorktreeInfo: (session: AiVaultSession) => AiVaultSessionWorktreeInfo | null
  allWorktrees: Worktree[]
  repos: Repo[]
  resumeTargetState: AiVaultSessionResumeTargetState
}): {
  copyText: (text: string, label: string) => Promise<void>
  getSessionResumeState: (
    session: AiVaultSession
  ) => ReturnType<typeof resolveAiVaultSessionResumeState>
  getSessionResumeActions: (
    session: AiVaultSession
  ) => ReturnType<typeof resolveAiVaultSessionResumeActions>
} {
  const {
    effectiveActiveWorktreeId,
    getSessionWorktreeInfo,
    allWorktrees,
    repos,
    resumeTargetState
  } = args

  const copyText = useCallback(async (text: string, label: string): Promise<void> => {
    await window.api.ui.writeClipboardText(text)
    toast.success(
      translate('auto.components.right.sidebar.AiVaultPanel.valueCopied', '{{value0}} copied', {
        value0: label
      })
    )
  }, [])

  const getSessionResumeState = useCallback(
    (session: AiVaultSession) =>
      resolveAiVaultSessionResumeState({
        sessionFilePath: session.filePath,
        sessionExecutionHostId: session.executionHostId,
        worktreeInfo: getSessionWorktreeInfo(session),
        activeWorktreeId: effectiveActiveWorktreeId,
        worktrees: allWorktrees,
        repos,
        targetState: resumeTargetState
      }),
    [allWorktrees, effectiveActiveWorktreeId, getSessionWorktreeInfo, repos, resumeTargetState]
  )

  const getSessionResumeActions = useCallback(
    (session: AiVaultSession) =>
      resolveAiVaultSessionResumeActions({
        sessionFilePath: session.filePath,
        sessionExecutionHostId: session.executionHostId,
        worktreeInfo: getSessionWorktreeInfo(session),
        activeWorktreeId: effectiveActiveWorktreeId,
        worktrees: allWorktrees,
        repos,
        targetState: resumeTargetState
      }),
    [allWorktrees, effectiveActiveWorktreeId, getSessionWorktreeInfo, repos, resumeTargetState]
  )

  return { copyText, getSessionResumeState, getSessionResumeActions }
}
