import { useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

export type CodevProviderSurfaceTab = {
  id: string
  label: string
  description: string
  content: ReactNode
}

export function CodevProviderSurfaceTabs({
  tabs,
  initialTabId
}: {
  tabs: CodevProviderSurfaceTab[]
  initialTabId?: string
}): ReactNode {
  const [active, setActive] = useState(
    initialTabId && tabs.some((tab) => tab.id === initialTabId) ? initialTabId : tabs[0]!.id
  )
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0]!

  return (
    <div className="space-y-3">
      <div
        aria-label="Provider integration surface"
        className="inline-flex gap-1 rounded-lg border border-border/60 bg-muted/40 p-1"
        role="tablist"
      >
        {tabs.map((tab) => (
          <button
            aria-controls={`${tab.id}-panel`}
            aria-selected={tab.id === active}
            className={cn(
              'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
              tab.id === active
                ? 'bg-primary shadow-xs'
                : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
            )}
            id={`${tab.id}-tab`}
            key={tab.id}
            onClick={() => setActive(tab.id)}
            role="tab"
            style={tab.id === active ? { color: 'var(--color-primary-foreground)' } : undefined}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{current.description}</p>
      <div
        aria-labelledby={`${current.id}-tab`}
        className="space-y-3"
        data-settings-section={current.id}
        id={`${current.id}-panel`}
        role="tabpanel"
      >
        {current.content}
      </div>
    </div>
  )
}
