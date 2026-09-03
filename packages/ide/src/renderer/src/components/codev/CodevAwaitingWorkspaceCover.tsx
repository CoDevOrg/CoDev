import { useEffect, useState } from 'react'
import { NativeChatEmptyState } from '../native-chat/NativeChatEmptyState'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { retryCodevProjectBootstrap } from '@/web/codev-project-bootstrap'
import { failedCodevWorktreeCreationError } from '@/web/codev-default-chat-tab'

/** How long the plain loading state holds before offering a manual retry.
 *  Covers ordinary handoff latency (host waking, repo registering, agent
 *  worktree cloning) without reading as broken. */
const RETRY_OFFER_DELAY_MS = 10_000

/**
 * What a CoDev member sees while the workspace has no active worktree yet.
 *
 * Stock Orca renders `Landing` here, which tells the reader to "select a
 * workspace from the sidebar" and offers Add Project / Create worktree. None of
 * that exists in CoDev: the left rail is the team panel and the "+" is hidden,
 * so `Landing` is a dead end that advertises affordances the member cannot
 * reach. This replaces it with the workspace's actual state plus the one action
 * that can help — running the project handoff again.
 *
 * A worktree create that already failed is shown verbatim instead of a spinner,
 * because that failure is otherwise announced only as a toast that expires.
 */
export function CodevAwaitingWorkspaceCover(): React.JSX.Element {
  const [showRetry, setShowRetry] = useState(false)
  // Why: bumping this restarts the wait-then-offer cycle after a click, so the
  // retry button does not vanish for good once used.
  const [cycle, setCycle] = useState(0)
  const creationError = useAppStore((state) => failedCodevWorktreeCreationError(state))

  useEffect(() => {
    setShowRetry(false)
    const timer = window.setTimeout(() => setShowRetry(true), RETRY_OFFER_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [cycle])

  if (!showRetry && !creationError) {
    return <NativeChatEmptyState kind="loading" />
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-muted-foreground">
        {creationError ??
          translate(
            'components.codev.awaitingWorkspace.message',
            'Still starting your workspace — this is taking longer than usual.'
          )}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          retryCodevProjectBootstrap()
          setCycle((value) => value + 1)
        }}
      >
        {translate('components.codev.awaitingWorkspace.retry', 'Try again')}
      </Button>
    </div>
  )
}
