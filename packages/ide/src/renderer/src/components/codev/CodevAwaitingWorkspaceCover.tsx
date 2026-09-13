import { useEffect, useState } from 'react'
import { NativeChatEmptyState } from '../native-chat/NativeChatEmptyState'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { retryCodevProjectBootstrap } from '@/web/codev-project-bootstrap'
import { failedCodevWorktreeCreationError } from '@/web/codev-default-chat-tab'
import { requestCodevHostRetry, useCodevHostState } from '@/web/codev-host-state'

/** How long the plain loading state holds before offering a manual retry, once
 *  the machine is up. Well past a warm handoff (repo registering, agent
 *  worktree cloning) so the offer means something went wrong, not that a cold
 *  boot is running long — the host wake itself is reported separately and never
 *  counted here. */
const RETRY_OFFER_DELAY_MS = 90_000

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
 * Two states, because there are two reasons to be here. While the parent page
 * reports the machine as still waking, this says so and offers nothing: the
 * parent is already polling, and re-running the handoff cannot make an EC2
 * instance boot faster. Only once the host is up does the stopwatch start, and
 * only then can retrying mean anything.
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
  const hostState = useCodevHostState()
  const hostStarting = hostState?.phase === 'starting'

  useEffect(() => {
    setShowRetry(false)
    if (hostStarting) {
      // The clock belongs to the handoff, not to the machine: a cold boot must
      // not spend the member's patience before the handoff has even started.
      return
    }
    const timer = window.setTimeout(() => setShowRetry(true), RETRY_OFFER_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [cycle, hostStarting])

  if (creationError) {
    return (
      <AwaitingWorkspaceNotice message={creationError} onRetry={() => setCycle((c) => c + 1)} />
    )
  }

  // The parent's poll is failing, not merely waiting: say what it hit and
  // offer the one thing that helps, restarting that poll. Without this an
  // unreachable runtime looked identical to a slow cold boot forever.
  if (hostStarting && hostState?.slow && hostState.failure) {
    const { message, attempts } = hostState.failure
    return (
      <AwaitingWorkspaceNotice
        message={translate(
          'components.codev.awaitingWorkspace.hostFailing',
          'CoDev cannot reach your workspace’s machine. The last {{attempts}} attempts failed: {{message}}. It keeps retrying on its own.',
          { attempts: String(attempts), message }
        )}
        retryLabel={translate('components.codev.awaitingWorkspace.retryConnect', 'Retry now')}
        onRetry={requestCodevHostRetry}
      />
    )
  }

  if (hostStarting) {
    return (
      <AwaitingWorkspaceNotice
        message={
          hostState?.slow
            ? translate(
                'components.codev.awaitingWorkspace.hostSlow',
                'Still starting your workspace’s machine. This one is taking longer than usual — it will open on its own.'
              )
            : translate(
                'components.codev.awaitingWorkspace.host',
                'Starting your workspace’s machine. This takes about a minute from cold.'
              )
        }
      />
    )
  }

  if (!showRetry) {
    return <NativeChatEmptyState kind="loading" />
  }

  return (
    <AwaitingWorkspaceNotice
      message={translate(
        'components.codev.awaitingWorkspace.message',
        'Still starting your workspace — this is taking longer than usual.'
      )}
      onRetry={() => setCycle((current) => current + 1)}
    />
  )
}

function AwaitingWorkspaceNotice({
  message,
  onRetry,
  retryLabel
}: {
  message: string
  /** Given a label, the button runs only `onRetry`; without one it re-runs
   *  the project handoff, which is the right recovery once the host is up. */
  onRetry?: () => void
  retryLabel?: string
}): React.JSX.Element {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      {onRetry ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            if (!retryLabel) {
              retryCodevProjectBootstrap()
            }
            onRetry()
          }}
        >
          {retryLabel ?? translate('components.codev.awaitingWorkspace.retry', 'Try again')}
        </Button>
      ) : null}
    </div>
  )
}
