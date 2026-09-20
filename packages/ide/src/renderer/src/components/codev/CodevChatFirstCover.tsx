import { MessageSquare, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * CoDev's center is a chat surface, even while the runtime host is mirroring
 * the agent tab. The underlying Terminal workbench stays mounted for state and
 * PTY ownership, but this cover makes the raw shell unreachable and invisible.
 */
export function CodevChatFirstCover({
  error,
  managed = false,
  launching = false,
  onStart
}: {
  error?: string | null
  managed?: boolean
  launching?: boolean
  onStart?: () => void
}): React.JSX.Element {
  const failed = Boolean(error) && !managed
  const opening = launching && !managed && !failed
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-3 bg-background p-6 text-center"
      data-codev-chat-first="true"
      role={failed ? 'alert' : 'status'}
      aria-live="polite"
    >
      <div
        className={
          failed
            ? 'flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive'
            : 'flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground'
        }
        aria-hidden="true"
      >
        {failed ? <TriangleAlert className="size-6" /> : <MessageSquare className="size-6" />}
      </div>
      <h2 className="text-sm font-medium text-foreground">
        {managed
          ? 'Managed agent workspace'
          : failed
            ? 'Chat could not start'
            : opening
              ? 'Opening your chat…'
              : 'Start a workspace chat'}
      </h2>
      <p className="max-w-sm text-balance text-xs text-muted-foreground">
        {managed
          ? 'This agent is controlled from Mission Control. Open Agents on the right to view its shared conversation and send instructions.'
          : failed
            ? error
            : opening
              ? 'Your workspace opens in chat. The terminal stays hidden until you open it from the chat toolbar.'
              : 'No agent will start until you choose to begin. You can start a chat whenever you are ready.'}
      </p>
      {!managed && !opening && onStart ? (
        <Button className="min-h-11 px-6" type="button" onClick={onStart}>
          {failed ? 'Try again' : 'Start chat'}
        </Button>
      ) : null}
    </div>
  )
}
