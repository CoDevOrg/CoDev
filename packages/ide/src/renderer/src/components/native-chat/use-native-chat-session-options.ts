import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { getSettingsForAgentTabRuntimeOwner } from '@/lib/agent-paste-draft'
import { sendRuntimePtyInput } from '@/runtime/runtime-terminal-inspection'
import type { AgentType } from '../../../../shared/agent-status-types'
import { updateNativeChatSessionOptionDefaults } from '../../../../shared/native-chat-session-option-defaults'
import type {
  SessionOptionDescriptor,
  SessionOptionValue
} from '../../../../shared/native-chat-session-options'
import { useAppStore } from '../../store'
import { isCodevEmbedded } from '@/web/codev-embedded'
import {
  createNativeChatPtySessionOptions,
  type NativeChatPtySessionOptionsSurface
} from './native-chat-pty-session-options'
import type { NativeChatSessionOptionDispatchCommand } from './native-chat-session-option-command-dispatch'
import {
  ensureNativeChatModelEnrichment,
  readNativeChatEnrichedModels,
  subscribeNativeChatEnrichedModels
} from './native-chat-session-option-enrichment'
import {
  discoverNativeChatCatalogModels,
  resolveNativeChatModelDiscoveryContext
} from './native-chat-session-option-discovery'
import { readClaudeSessionOptionsFromTerminalScreen } from './claude-terminal-session-options'

const EMPTY_SNAPSHOT: SessionOptionDescriptor[] = []
const subscribeEmpty = (): (() => void) => () => {}
const getEmptySnapshot = (): SessionOptionDescriptor[] => EMPTY_SNAPSHOT

const CODEX_EFFORT_INDEX: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  xhigh: 3,
  max: 4,
  ultra: 5
}

async function waitForTerminalText(
  readTerminalScreen: (() => string | null) | undefined,
  expected: string,
  timeoutMs = 3000
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (readTerminalScreen?.()?.includes(expected)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Codex did not open ${expected}.`)
}

export function codexEffortPickerInput(value: SessionOptionValue): string {
  const index = CODEX_EFFORT_INDEX[String(value)]
  if (index === undefined) {
    throw new Error(`Codex does not support reasoning effort ${String(value)} here.`)
  }
  return `\u001b[H${'\u001b[B'.repeat(index)}\r`
}

export function useNativeChatSessionOptions(args: {
  agent: AgentType
  terminalTabId: string
  targetPtyId: string | null
  dispatchCommand: NativeChatSessionOptionDispatchCommand
  onAgentPicker?: () => void
  readTerminalScreen?: () => string | null
}): {
  surface: NativeChatPtySessionOptionsSurface | null
  snapshot: SessionOptionDescriptor[]
} {
  const { agent, terminalTabId, targetPtyId, dispatchCommand, onAgentPicker, readTerminalScreen } =
    args
  // The screen text that last parsed into reported values, so a later model
  // discovery can re-resolve it against the host's real ids.
  const reportedScreenRef = useRef<string | null>(null)
  const discoveryContext = useMemo(
    () => resolveNativeChatModelDiscoveryContext(terminalTabId),
    [terminalTabId]
  )
  const surface = useMemo(() => {
    // Why: native chat normally attaches only after startup is already queued,
    // so a pre-PTY draft picker would claim it can still mutate that command.
    // CoDev opens the workspace's default chat tab with an empty composer
    // before the paired host's PTY mirrors, so there it shows the draft-mode
    // model/effort pickers at their catalog defaults from first paint; the
    // surface re-creates in 'live' mode once the PTY arrives and reconciles
    // any pre-PTY selection through the agent's own picker.
    if (!targetPtyId && !isCodevEmbedded()) {
      return null
    }
    const scopeKey = targetPtyId ?? terminalTabId
    const discoveredModels = discoveryContext
      ? readNativeChatEnrichedModels(agent, discoveryContext.hostKey)
      : null
    const reportedValues =
      agent === 'claude'
        ? readClaudeSessionOptionsFromTerminalScreen(
            readTerminalScreen?.(),
            discoveredModels ?? undefined
          )
        : null
    let settingsWrite = Promise.resolve()
    const applyAgentPickerChoice =
      agent === 'codex' && targetPtyId
        ? async ({ optionId, value }: { optionId: string; value: SessionOptionValue }) => {
            if (optionId !== 'effort') {
              throw new Error('This Codex option is not available in chat.')
            }
            await dispatchCommand('/model')
            await waitForTerminalText(readTerminalScreen, 'Select Model and Effort')
            const settings = getSettingsForAgentTabRuntimeOwner(terminalTabId)
            sendRuntimePtyInput(settings, targetPtyId, '\r')
            await waitForTerminalText(readTerminalScreen, 'Select Reasoning Level')
            sendRuntimePtyInput(settings, targetPtyId, codexEffortPickerInput(value))
          }
        : undefined
    return createNativeChatPtySessionOptions({
      agent,
      scopeKey,
      ...(targetPtyId ? { fallbackScopeKey: terminalTabId } : {}),
      // Why: the catalog seed carries version-neutral family labels, so it is
      // safe on every host while the once-per-host probe runs or after it fails
      // — without it the whole picker would pop in late or never appear.
      ...(discoveryContext ? { initialModels: discoveredModels ?? undefined } : {}),
      mode: targetPtyId ? 'live' : 'draft',
      reportedValues,
      dispatchCommand,
      onAgentPicker,
      applyAgentPickerChoice,
      persistSelection: async ({ modelId, optionId, value }) => {
        // Why: read the live persisted defaults at write time (after any prior
        // write in this chain settles) and merge only this selection onto them,
        // rather than a baseline captured once at surface creation. A frozen
        // baseline would let a second same-agent pane's write be clobbered,
        // since updateSettings shallow-merges nativeChatSessionOptions. Chaining
        // still keeps rapid consecutive picks in selection order.
        settingsWrite = settingsWrite
          .catch(() => undefined)
          .then(() => {
            const base = useAppStore.getState().settings?.nativeChatSessionOptions
            const next = updateNativeChatSessionOptionDefaults({
              persisted: base,
              agent,
              modelId,
              optionId,
              value
            })
            return useAppStore.getState().updateSettings({ nativeChatSessionOptions: next })
          })
        await settingsWrite
      }
    })
  }, [
    agent,
    dispatchCommand,
    discoveryContext,
    onAgentPicker,
    readTerminalScreen,
    targetPtyId,
    terminalTabId
  ])

  useEffect(() => {
    if (!surface || agent !== 'claude') {
      return
    }
    let cancelled = false
    reportedScreenRef.current = null
    const reportCurrentValues = async (): Promise<void> => {
      let authoritativeScreen: string | null = null
      if (targetPtyId && window.api?.pty?.getMainBufferSnapshot) {
        try {
          const snapshot = await window.api.pty.getMainBufferSnapshot(targetPtyId, {
            scrollbackRows: 0
          })
          // Why: the API snapshots the main buffer, which is stale while a TUI
          // owns the alternate screen. The mounted xterm is authoritative then.
          authoritativeScreen = snapshot?.alternateScreen ? null : (snapshot?.data ?? null)
        } catch {
          // The mounted renderer buffer remains a transport-neutral fallback.
        }
      }
      const models = discoveryContext
        ? readNativeChatEnrichedModels(agent, discoveryContext.hostKey)
        : null
      for (const screen of [authoritativeScreen, readTerminalScreen?.() ?? null]) {
        const reportedValues = readClaudeSessionOptionsFromTerminalScreen(
          screen,
          models ?? undefined
        )
        if (!reportedValues) {
          continue
        }
        // Why: discovery can land after this read. Keeping the screen that
        // parsed lets it re-resolve against the host's real ids later, when the
        // frame itself may have already scrolled out of the buffer.
        if (cancelled) {
          return
        }
        reportedScreenRef.current = screen
        surface.reportSessionOptions(reportedValues)
        return
      }
    }
    void reportCurrentValues()
    return () => {
      cancelled = true
    }
  }, [agent, discoveryContext, readTerminalScreen, surface, targetPtyId])

  useEffect(() => {
    if (!surface || !discoveryContext) {
      return
    }
    const unsubscribe = subscribeNativeChatEnrichedModels(
      agent,
      discoveryContext.hostKey,
      (models) => {
        surface.replaceModels(models)
        const screen = agent === 'claude' ? reportedScreenRef.current : null
        const reportedValues = screen
          ? readClaudeSessionOptionsFromTerminalScreen(screen, models)
          : null
        if (reportedValues) {
          surface.reportSessionOptions(reportedValues)
        }
      }
    )
    ensureNativeChatModelEnrichment({
      agent,
      hostKey: discoveryContext.hostKey,
      discover: () => discoverNativeChatCatalogModels(agent, discoveryContext.runtime)
    })
    return unsubscribe
  }, [agent, discoveryContext, surface])

  const snapshot = useSyncExternalStore(
    surface?.subscribe ?? subscribeEmpty,
    surface?.getSnapshot ?? getEmptySnapshot,
    surface?.getSnapshot ?? getEmptySnapshot
  )
  return { surface, snapshot }
}
