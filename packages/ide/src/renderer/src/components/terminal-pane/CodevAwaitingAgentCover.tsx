import { useEffect, useState } from 'react'
import { NativeChatEmptyState } from '../native-chat/NativeChatEmptyState'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { launchCodevDefaultChatTab } from '@/web/codev-default-chat-tab'

/** How long to show the plain loading state before offering a manual retry.
 *  Covers ordinary auto-launch latency (host/runtime not ready yet) without
 *  reading as broken; past this the member gets a way out instead of staring
 *  at a spinner if launchCodevDefaultChatTab's own attempt silently failed
 *  (see codev-project-bootstrap.ts's catch-and-warn). */
const RETRY_OFFER_DELAY_MS = 10_000

/**
 * Covers a CoDev worktree's raw host terminal while its default chat tab is
 * still launching (or failed to — the launch is fire-and-forget and only
 * warns to the console on failure, never surfacing an error here). Offers a
 * manual retry after a delay so a member is never permanently stranded on a
 * bare shell with no "+" left to open a chat tab by hand.
 */
export function CodevAwaitingAgentCover({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const [showRetry, setShowRetry] = useState(false)
  // Why: bumping this restarts the wait-then-offer-retry cycle after a manual
  // click, without it the effect (keyed on worktreeId, unchanged by a click)
  // never reschedules and the retry button would vanish for good.
  const [cycle, setCycle] = useState(0)

  useEffect(() => {
    setShowRetry(false)
    const timer = window.setTimeout(() => setShowRetry(true), RETRY_OFFER_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [worktreeId, cycle])

  if (!showRetry) {
    return <NativeChatEmptyState kind="loading" />
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-muted-foreground">
        {translate(
          'components.native-chat.awaitingAgent.message',
          "Still starting your assistant — this is taking longer than usual."
        )}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          launchCodevDefaultChatTab({ worktreeId })
          setCycle((value) => value + 1)
        }}
      >
        {translate('components.native-chat.awaitingAgent.retry', 'Try again')}
      </Button>
    </div>
  )
}
