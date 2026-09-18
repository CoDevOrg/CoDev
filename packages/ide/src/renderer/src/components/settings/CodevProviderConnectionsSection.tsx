import { useEffect, useState, type JSX } from 'react'

import { useAppStore } from '@/store'
import {
  applyCodevProviderReadiness,
  requestCodevProviderReadinessRefresh
} from '@/web/codev-provider-readiness'

import { loadCodevProviderSnapshot } from './codev-provider-account-api'
import {
  CODEV_PROVIDER_SURFACE_TABS,
  type CodevProviderConnectionSnapshot
} from './codev-provider-connection-types'
import { isCodevEmbedded } from './codev-personal-settings'
import { CodevProviderSurfaceCards } from './CodevProviderSurfaceCards'
import {
  codevProviderSurfaceCapability,
  codevWorkspaceReadyAgent
} from './codev-provider-surface-capability'
import { CodevProviderSurfaceTabs } from './CodevProviderSurfaceTabs'

export function publishCodevWorkspaceReadyFromSnapshot(
  snapshot: CodevProviderConnectionSnapshot
): void {
  const agent = codevWorkspaceReadyAgent(snapshot)
  if (!agent) {
    return
  }
  applyCodevProviderReadiness({
    ready: true,
    agent,
    reason: null,
    settingsHref: null,
    providers: {
      claude: codevProviderSurfaceCapability(snapshot, 'anthropic').workspace.ready,
      codex: codevProviderSurfaceCapability(snapshot, 'openai').workspace.ready
    }
  })
  requestCodevProviderReadinessRefresh()
}

function codevProviderSettingsTabId(sectionId: string | undefined): string | undefined {
  if (sectionId === 'coding-workspaces' || sectionId === 'chat-rooms') {
    return sectionId
  }
  return undefined
}

export function CodevProviderConnectionsView({
  connected,
  snapshot,
  onSnapshot,
  initialTabId
}: {
  connected: boolean
  snapshot: CodevProviderConnectionSnapshot | null
  onSnapshot: (snapshot: CodevProviderConnectionSnapshot | null) => void
  initialTabId?: string
}): JSX.Element {
  return (
    <div
      className="space-y-3"
      data-codev-provider-connections="true"
      id="codev-provider-connections"
    >
      {!connected ? (
        <p className="text-xs text-muted-foreground">
          Could not load provider accounts. Try reopening Settings.
        </p>
      ) : snapshot ? (
        <CodevProviderSurfaceTabs
          initialTabId={initialTabId}
          tabs={CODEV_PROVIDER_SURFACE_TABS.map((tab) => ({
            id: tab.id,
            label: tab.label,
            description: tab.description,
            content: (
              <CodevProviderSurfaceCards
                onSnapshot={onSnapshot}
                snapshot={snapshot}
                surface={tab.surface}
              />
            )
          }))}
        />
      ) : (
        <p className="text-xs text-muted-foreground">Loading provider accounts…</p>
      )}
    </div>
  )
}

export function CodevProviderConnectionsSection(): JSX.Element | null {
  const embedded = typeof window !== 'undefined' && isCodevEmbedded()
  const initialTabId = useAppStore((state) =>
    codevProviderSettingsTabId(state.settingsNavigationTarget?.sectionId)
  )
  const [snapshot, setSnapshot] = useState<CodevProviderConnectionSnapshot | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!embedded) {
      return
    }
    let cancelled = false
    void loadCodevProviderSnapshot()
      .then((result) => {
        if (!cancelled) {
          setSnapshot(result)
          setConnected(true)
          publishCodevWorkspaceReadyFromSnapshot(result)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSnapshot(null)
          setConnected(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [embedded])

  if (!embedded) {
    return null
  }

  return (
    <CodevProviderConnectionsView
      connected={connected}
      initialTabId={initialTabId}
      onSnapshot={(next) => {
        if (next) {
          setSnapshot(next)
          publishCodevWorkspaceReadyFromSnapshot(next)
          return
        }
        void loadCodevProviderSnapshot()
          .then((result) => {
            setSnapshot(result)
            publishCodevWorkspaceReadyFromSnapshot(result)
          })
          .catch(() => {})
      }}
      snapshot={snapshot}
    />
  )
}
