import { useEffect, useRef, useState, type JSX } from 'react'
import { ChevronDown, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ClaudeMark, OpenAIMark } from '../settings/CodevProviderLogos'
import { isCodevEmbedded } from '@/web/codev-embedded'
import { startCodevManagedAgentWithToast } from '@/web/codev-managed-agent'
import { openCodevWorkspaceProviderSettings } from '@/web/codev-open-provider-settings'
import { useCodevProviderReadiness } from '@/web/codev-provider-readiness'

/** The workspace's sessions, in the top half of the left rail. Discoverability:
 *  a member should see their conversations without opening a panel. */
export function CodevChatsSection(): JSX.Element | null {
  const [pending, setPending] = useState(false)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const readiness = useCodevProviderReadiness()

  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (!isCodevEmbedded()) {
    return null
  }

  const providerReady = (provider: 'claude' | 'codex'): boolean =>
    readiness?.providers?.[provider] ?? readiness?.agent === provider

  const start = (provider: 'claude' | 'codex'): void => {
    if (!providerReady(provider)) {
      openCodevWorkspaceProviderSettings()
      setOpen(false)
      return
    }
    setPending(true)
    setOpen(false)
    void startCodevManagedAgentWithToast({
      provider: provider === 'claude' ? 'anthropic' : 'openai'
    })
      .catch(() => undefined)
      .finally(() => setPending(false))
  }

  return (
    <div ref={rootRef} className="in-left-rail relative px-2 py-2">
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-full justify-between gap-2 text-xs"
        disabled={pending}
        aria-busy={pending}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-md bg-worktree-sidebar-foreground/8">
            <ClaudeMark className="size-3.5 text-[#d97757]" />
          </span>
          <span className="truncate">{pending ? 'Starting CoDev agent…' : 'New CoDev agent'}</span>
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Button>
      {open ? (
        <div
          role="menu"
          aria-label="Choose an agent provider"
          className="absolute inset-x-2 top-full z-50 mt-1 overflow-hidden rounded-lg border border-worktree-sidebar-border bg-popover p-1 shadow-lg"
        >
          <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Start with a provider
          </p>
          {[
            {
              id: 'claude' as const,
              label: 'Claude',
              logo: <ClaudeMark className="size-4 text-[#d97757]" />
            },
            {
              id: 'codex' as const,
              label: 'Codex',
              logo: <OpenAIMark className="size-4 text-foreground/80" />
            }
          ].map((provider) => {
            const connected = providerReady(provider.id)
            return (
              <button
                key={provider.id}
                type="button"
                role="menuitem"
                className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => start(provider.id)}
              >
                <span className="flex size-7 items-center justify-center rounded-md bg-muted">
                  {provider.logo}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{provider.label}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {connected ? 'Connected · start agent' : 'Not connected · open Settings'}
                  </span>
                </span>
                {!connected ? (
                  <Settings2
                    className="size-3.5 text-muted-foreground"
                    aria-label="Connect in Settings"
                  />
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export default CodevChatsSection
