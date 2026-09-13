import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AgentUpdateProvider } from './agent-update-prompt'

const PROVIDER_COPY: Record<
  AgentUpdateProvider,
  { name: string; title: string; description: string }
> = {
  codex: {
    name: 'Codex',
    title: 'Codex update available',
    description: 'Update Codex before continuing this session.'
  },
  claude: {
    name: 'Claude Code',
    title: 'Claude Code update available',
    description: 'Update Claude Code before continuing this session.'
  }
}

export function AgentUpdatePromptBanner({
  provider,
  updating,
  onUpdate,
  onSkip
}: {
  provider: AgentUpdateProvider
  updating: boolean
  onUpdate: () => void
  onSkip: () => void
}): React.JSX.Element {
  const copy = PROVIDER_COPY[provider]
  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-background px-6 py-8"
      data-agent-update-prompt-banner={provider}
    >
      <div
        className="flex w-full max-w-xl items-center gap-3 rounded-md border border-border bg-card px-4 py-4 text-card-foreground shadow-lg"
        role="status"
        aria-live="polite"
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
          {updating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{copy.title}</div>
          <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{copy.description}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            className="min-h-11"
            variant="outline"
            disabled={updating}
            onClick={onSkip}
          >
            Skip
          </Button>
          <Button
            type="button"
            className="min-h-11"
            disabled={updating}
            onClick={onUpdate}
            aria-label={updating ? `Updating ${copy.name}` : `Update ${copy.name}`}
          >
            {updating ? 'Updating…' : `Update ${copy.name}`}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default AgentUpdatePromptBanner
