import { useState, type JSX } from 'react'
import { Bot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isCodevEmbedded } from '@/web/codev-embedded'
import { startCodevManagedAgentWithToast } from '@/web/codev-managed-agent'
import { openCodevWorkspaceProviderSettings } from '@/web/codev-open-provider-settings'
import { useCodevAgentSendGate } from '@/web/codev-provider-readiness'

/** The workspace's sessions, in the top half of the left rail. Discoverability:
 *  a member should see their conversations without opening a panel. */
export function CodevChatsSection(): JSX.Element | null {
  const [pending, setPending] = useState(false)
  const sendGate = useCodevAgentSendGate()

  if (!isCodevEmbedded()) {
    return null
  }

  const needsProvider = sendGate.blocked

  return (
    <div className="in-left-rail px-2 py-2">
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-full justify-start gap-2 text-xs"
        disabled={pending}
        aria-busy={pending}
        onClick={() => {
          if (needsProvider) {
            openCodevWorkspaceProviderSettings()
            return
          }
          setPending(true)
          void startCodevManagedAgentWithToast()
            .then(() => undefined)
            .catch(() => undefined)
            .finally(() => setPending(false))
        }}
      >
        <Bot className="size-3.5" aria-hidden="true" />
        {needsProvider ? 'Open Settings' : pending ? 'Starting CoDev agent…' : 'New CoDev agent'}
      </Button>
    </div>
  )
}

export default CodevChatsSection
