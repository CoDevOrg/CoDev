import { useCallback, type JSX } from 'react'
import { MessageSquarePlus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { openCodevWorkspaceProviderSettings } from '@/web/codev-open-provider-settings'

export function CodevFirstChatProviderSetupView({
  reason,
  onOpenSettings
}: {
  reason: string | null
  onOpenSettings: () => void
}): JSX.Element {
  const subtitle =
    reason?.trim() ||
    'A workspace chat needs Claude or Codex. Connect one in Settings, then you can start a session.'
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center"
      data-codev-first-chat-setup="true"
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <MessageSquarePlus aria-hidden="true" className="size-6" />
      </div>
      <h1 className="text-sm font-medium text-foreground" id="codev-first-chat-setup-title">
        Connect an agent to start
      </h1>
      <p className="max-w-sm text-pretty text-sm leading-6 text-muted-foreground">{subtitle}</p>
      <Button className="min-h-11 px-6" onClick={onOpenSettings} type="button">
        Open Settings
      </Button>
    </div>
  )
}

/**
 * First-visit workspace chat: one button opens in-workspace Settings on
 * AI Provider Accounts (Coding workspaces). The member never leaves the IDE.
 */
export function CodevFirstChatProviderSetup({ reason }: { reason: string | null }): JSX.Element {
  const onOpenSettings = useCallback(() => {
    openCodevWorkspaceProviderSettings()
  }, [])

  return <CodevFirstChatProviderSetupView onOpenSettings={onOpenSettings} reason={reason} />
}
