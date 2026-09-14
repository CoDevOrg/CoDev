import { useEffect, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { NativeChatEmptyState } from '../native-chat/NativeChatEmptyState'
import { Button } from '@/components/ui/button'
import AgentCombobox from '@/components/agent/AgentCombobox'
import { getAgentCatalog } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'
import type { TuiAgent } from '../../../../shared/types'
import { useCodevAgentLaunching } from '@/web/codev-agent-launch-state'
import { frontCodevChatTab } from '@/web/codev-center-chat-tab'
import { launchCodevDefaultChatTab } from '@/web/codev-default-chat-tab'
import { codevSessionAgents } from '@/web/codev-session-agents'

/** Ordinary auto-launch latency; past this a silently-failed launch needs a
 *  way out (codev-project-bootstrap.ts catches and only warns). */
const RETRY_OFFER_DELAY_MS = 10_000

/**
 * Covers any CoDev terminal tab that is not showing chat: the center is only
 * ever chat. When the worktree has a chat elsewhere, the center moves back to
 * it; otherwise launching, stalled and "nothing running" are separate screens —
 * conflating them told a member who had just pressed Stop that their assistant
 * was still starting.
 */
export function CodevAwaitingAgentCover({
  worktreeId,
  tabId,
  isActive,
  hasChatTab
}: {
  worktreeId: string
  tabId: string
  isActive: boolean
  hasChatTab: boolean
}): React.JSX.Element {
  const launching = useCodevAgentLaunching(worktreeId)
  const [stalled, setStalled] = useState(false)
  // Why: bumping this restarts the wait-then-offer-retry cycle after a manual
  // click; without it the effect (keyed on worktreeId, unchanged by a click)
  // never reschedules and the retry button would vanish for good.
  const [cycle, setCycle] = useState(0)
  // Unselected on purpose: choosing the agent is what starts the session.
  const [agent, setAgent] = useState<TuiAgent | null>(null)

  useEffect(() => {
    if (isActive && hasChatTab) {
      frontCodevChatTab(worktreeId, tabId)
    }
  }, [worktreeId, tabId, isActive, hasChatTab])

  useEffect(() => {
    if (!launching) {
      setStalled(false)
      return
    }
    setStalled(false)
    const timer = window.setTimeout(() => setStalled(true), RETRY_OFFER_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [worktreeId, cycle, launching])

  const start = (agent?: TuiAgent): void => {
    launchCodevDefaultChatTab({ worktreeId, ...(agent ? { agent } : {}) })
    setCycle((value) => value + 1)
  }

  if (hasChatTab || (launching && !stalled)) {
    return <NativeChatEmptyState kind="loading" />
  }

  if (launching) {
    return (
      <CoverLayout
        message={translate(
          'components.native-chat.awaitingAgent.message',
          'Still starting your agent — this is taking longer than usual.'
        )}
        action={translate('components.native-chat.awaitingAgent.retry', 'Try again')}
        onAction={() => start()}
      />
    )
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <MessageSquarePlus className="size-6" />
      </div>
      <p className="text-sm font-medium text-foreground">
        {translate('components.native-chat.noAgent.title', 'No agent running here')}
      </p>
      <p className="max-w-sm text-balance text-xs text-muted-foreground">
        {translate(
          'components.native-chat.noAgent.subtitle',
          'Nothing is running in this workspace. Start a session to pick the work back up.'
        )}
      </p>
      <AgentCombobox
        agents={codevSessionAgents(getAgentCatalog())}
        value={agent}
        onValueChange={setAgent}
        onValueSelected={(selected) => {
          if (!selected) {
            return
          }
          start(selected)
          setAgent(null)
        }}
        emptyLabel={translate('components.native-chat.noAgent.start', 'Start a session')}
        allowNarrowTrigger
        allowBlankTerminal={false}
      />
    </div>
  )
}

function CoverLayout({
  message,
  action,
  onAction
}: {
  message: string
  action: string
  onAction: () => void
}): React.JSX.Element {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button type="button" variant="outline" size="sm" onClick={onAction}>
        {action}
      </Button>
    </div>
  )
}
