import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import { subscribeToTerminalUserInput } from '@/components/terminal-pane/terminal-user-input-signal'
import { composeActiveTerminalTheme } from '@/components/terminal-pane/terminal-appearance'
import { useSystemPrefersDark } from '@/components/terminal-pane/use-system-prefers-dark'
import { TerminalKittyKeyboardModeTracker } from '../../../../shared/terminal-kitty-keyboard-mode-tracker'
import { useEffectiveMacOptionAsAlt } from '@/lib/keyboard-layout/use-effective-mac-option-as-alt'
import {
  buildPreviewAppearanceOptions,
  buildPreviewTerminalOptions
} from '../dashboard-popout/preview-terminal-options'
import { syncPreviewTerminalLigatures } from '../dashboard-popout/preview-terminal-ligatures'
import { installPreviewTerminalCompatibility } from '../dashboard-popout/preview-terminal-compatibility'
import { createPreviewClipboardPaster } from '../dashboard-popout/preview-terminal-paste'
import {
  installPreviewImeBridge,
  type PreviewImeBridge
} from '../dashboard-popout/preview-terminal-ime-bridge'
import { installPreviewTerminalKeyHandler } from '../dashboard-popout/preview-terminal-key-handler'
import { translate } from '@/i18n/i18n'
import { getBuiltinTheme, resolveEffectiveTerminalAppearance } from '@/lib/terminal-theme'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import {
  getRemoteRuntimePtyEnvironmentId,
  getRemoteRuntimeTerminalHandle
} from '@/runtime/runtime-terminal-stream'
import { isRemoteRuntimePtyId } from '@/runtime/runtime-terminal-inspection'
import {
  getRemoteRuntimeTerminalMultiplexer,
  type RemoteRuntimeMultiplexedTerminal
} from '@/runtime/remote-runtime-terminal-multiplexer'
import { createBrowserUuid } from '@/lib/browser-uuid'

const PREVIEW_SCROLLBACK_ROWS = 200
const PREVIEW_SCROLLBACK_BUFFER_ROWS = 2000
const FALLBACK_COLS = 80
const FALLBACK_ROWS = 24

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Live interactive view of the CoDev bottom drawer's shell.
 *
 * The pty here is the drawer's own plain shell (see `use-codev-drawer-terminal`),
 * not the agent's — pointing this at the agent replayed its running TUI, so a
 * member who asked for a terminal got Claude's status bar instead of a prompt.
 *
 * Because nothing else displays this shell, the drawer owns its grid: it fits
 * the terminal to the drawer's box and resizes the pty to match, so the shell
 * reflows and the text renders at normal size. (An earlier version rendered at
 * the host's cols and CSS-scaled the frame down, which is correct for mirroring
 * a pane someone else owns — here it just made the text tiny and wrapped the
 * prompt mid-line.) The shell is shared across the workspace's members, so the
 * last viewer to fit wins the grid.
 */
export function NativeChatTerminalDrawer({
  ptyId,
  className
}: {
  /** Null while the drawer's shell is still being created on the host. */
  ptyId: string | null
  className?: string
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const settings = useAppStore((state) => state.settings)
  const systemPrefersDark = useSystemPrefersDark()
  const macOptionAsAlt = useEffectiveMacOptionAsAlt(settings?.terminalMacOptionAsAlt)
  const settingsRef = useRef(settings)
  const macOptionAsAltRef = useRef(macOptionAsAlt)
  const { terminalTheme, terminalMode } = useMemo(() => {
    if (!settings) {
      return { terminalTheme: null, terminalMode: 'dark' as const }
    }
    const appearance = resolveEffectiveTerminalAppearance(settings, systemPrefersDark)
    const theme = composeActiveTerminalTheme(
      appearance.theme ?? getBuiltinTheme(appearance.themeName),
      settings
    )
    return { terminalTheme: theme, terminalMode: appearance.mode }
  }, [settings, systemPrefersDark])
  // A gone/unresolvable pty means no serializer knows this terminal (it died,
  // or this pane's transport isn't remote-runtime-backed) — say so instead of
  // painting a silent blank box.
  const [unavailable, setUnavailable] = useState(false)

  useLayoutEffect(() => {
    settingsRef.current = settings
    macOptionAsAltRef.current = macOptionAsAlt
  }, [settings, macOptionAsAlt])

  useEffect(() => {
    setUnavailable(false)
    const container = containerRef.current
    // No pty yet: the drawer's shell is still being created on the host. Stay
    // blank rather than claiming the terminal is gone.
    if (!container || !ptyId) {
      return
    }
    const environmentId = getRemoteRuntimePtyEnvironmentId(ptyId)
    const terminalHandle = getRemoteRuntimeTerminalHandle(ptyId)
    if (!isRemoteRuntimePtyId(ptyId) || !environmentId || !terminalHandle) {
      setUnavailable(true)
      return
    }

    let disposed = false
    let terminal: Terminal | null = null
    let fitAddon: FitAddon | null = null
    let stream: RemoteRuntimeMultiplexedTerminal | null = null
    let imeBridge: PreviewImeBridge | null = null
    let disposeKeyHandler: (() => void) | null = null
    let disposeTerminalCompatibility: (() => void) | null = null
    let userInputDisposable: { dispose: () => void } | null = null
    const kittyKeyboardModes = new TerminalKittyKeyboardModeTracker()
    const pendingLiveChunks: string[] = []

    // The drawer owns this shell outright — nothing else displays it — so it
    // sizes the grid to the box and tells the pty, rather than rendering at the
    // host's cols and CSS-scaling down. Scaling is what made the text tiny and
    // wrapped the prompt mid-line.
    const fitToBox = (): void => {
      const proposed = fitAddon?.proposeDimensions()
      if (
        !terminal ||
        !proposed ||
        !Number.isFinite(proposed.cols) ||
        !Number.isFinite(proposed.rows)
      ) {
        return
      }
      const cols = clamp(Math.floor(proposed.cols), 2, 500)
      const rows = clamp(Math.floor(proposed.rows), 2, 200)
      if (terminal.cols === cols && terminal.rows === rows) {
        return
      }
      terminal.resize(cols, rows)
      stream?.resize(cols, rows)
    }
    let fitScheduled = false
    const scheduleFit = (): void => {
      if (fitScheduled) {
        return
      }
      fitScheduled = true
      requestAnimationFrame(() => {
        fitScheduled = false
        fitToBox()
      })
    }
    const boxResizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => scheduleFit())
    if (container.parentElement) {
      boxResizeObserver?.observe(container.parentElement)
    }
    boxResizeObserver?.observe(container)

    const writeChunk = (chunk: string, live: boolean): void => {
      if (live) {
        kittyKeyboardModes.scan(chunk)
      } else {
        kittyKeyboardModes.scanReplay(chunk)
      }
      terminal?.write(chunk, () => scheduleFit())
    }

    const pasteClipboardText = createPreviewClipboardPaster({
      ptyId,
      container,
      getTerminal: () => terminal,
      isDisposed: () => disposed
    })

    const installInputRouting = (): void => {
      if (!terminal) {
        return
      }
      let pendingUserInputSignals = 0
      userInputDisposable = subscribeToTerminalUserInput(terminal, () => {
        pendingUserInputSignals = Math.min(32, pendingUserInputSignals + 1)
      })
      terminal.onData((data) => {
        const signaledUserInput = pendingUserInputSignals > 0
        if (signaledUserInput) {
          pendingUserInputSignals--
        }
        if (userInputDisposable && !signaledUserInput) {
          return
        }
        stream?.sendInput(data)
      })
    }

    const setup = async (): Promise<void> => {
      stream = await getRemoteRuntimeTerminalMultiplexer(environmentId).subscribeTerminal({
        terminal: terminalHandle,
        client: { id: `desktop:native-chat-drawer:${createBrowserUuid()}`, type: 'desktop' },
        callbacks: {
          onData: (data) => {
            if (!terminal) {
              pendingLiveChunks.push(data)
              return
            }
            writeChunk(data, true)
          },
          onSnapshot: (data) => {
            if (!terminal) {
              pendingLiveChunks.push(data)
              return
            }
            writeChunk(data, false)
          },
          onEnd: () => {
            if (!disposed) {
              setUnavailable(true)
            }
          },
          onError: () => {
            if (!disposed) {
              setUnavailable(true)
            }
          }
        }
      })
      if (disposed) {
        stream.close()
        return
      }
      const snapshot = await stream.serializeBuffer({ scrollbackRows: PREVIEW_SCROLLBACK_ROWS })
      if (disposed) {
        return
      }
      if (!snapshot) {
        setUnavailable(true)
        return
      }
      terminal = new Terminal(
        buildPreviewTerminalOptions({
          settings: settingsRef.current,
          terminalInput: null,
          macOptionIsMeta: macOptionAsAltRef.current === 'true',
          theme: terminalTheme,
          themeMode: terminalMode,
          cols: clamp(snapshot.cols ?? FALLBACK_COLS, 2, 500),
          rows: clamp(snapshot.rows ?? FALLBACK_ROWS, 2, 200),
          scrollback: PREVIEW_SCROLLBACK_BUFFER_ROWS
        })
      )
      try {
        terminal.open(container)
        fitAddon = new FitAddon()
        terminal.loadAddon(fitAddon)
      } catch {
        terminal.dispose()
        terminal = null
        return
      }
      terminalRef.current = terminal
      disposeTerminalCompatibility = installPreviewTerminalCompatibility(terminal, {
        getSettings: () => settingsRef.current
      })
      installInputRouting()
      imeBridge = installPreviewImeBridge(terminal)
      disposeKeyHandler = installPreviewTerminalKeyHandler({
        terminal,
        claimImeKeyEvent: (event) => imeBridge?.claimKeyEvent(event) ?? false,
        pasteClipboardText: (activeElement, source) =>
          void pasteClipboardText(activeElement, source),
        sendInput: (data) => terminal?.input(data),
        getShortcutContext: () => ({
          clientPlatform: getShortcutPlatform(),
          macOptionAsAlt: macOptionAsAltRef.current,
          keybindings: useAppStore.getState().keybindings,
          terminalInput: null,
          kittyKeyboardActive: () => kittyKeyboardModes.flags > 0,
          terminalShortcutPolicy: settingsRef.current?.terminalShortcutPolicy
        })
      })
      writeChunk(snapshot.data, false)
      for (const chunk of pendingLiveChunks.splice(0)) {
        writeChunk(chunk, true)
      }
      scheduleFit()
      terminal.focus()
    }

    void setup()

    return () => {
      disposed = true
      boxResizeObserver?.disconnect()
      imeBridge?.dispose()
      disposeTerminalCompatibility?.()
      disposeKeyHandler?.()
      userInputDisposable?.dispose()
      stream?.close()
      terminal?.dispose()
      terminalRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- terminalTheme/terminalMode intentionally excluded: an appearance change updates the open terminal's options in the effect below rather than reconnecting (which would repaint from a fresh snapshot).
  }, [ptyId])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }
    Object.assign(
      terminal.options,
      buildPreviewAppearanceOptions(settings, macOptionAsAlt === 'true')
    )
    syncPreviewTerminalLigatures(terminal, settings)
  }, [settings, macOptionAsAlt])

  return (
    <div
      className={cn('relative w-full overflow-hidden bg-background', className)}
      style={terminalTheme?.background ? { backgroundColor: terminalTheme.background } : undefined}
    >
      {unavailable ? (
        <div className="absolute inset-0 flex items-center justify-center px-2.5 py-4 text-center text-[11px] text-muted-foreground">
          {translate(
            'components.native-chat.terminalDrawer.unavailable',
            "No live terminal to show — this pane's session has closed."
          )}
        </div>
      ) : null}
      <div
        aria-hidden={unavailable || undefined}
        className={cn('h-full w-full overflow-hidden', unavailable && 'invisible')}
      >
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  )
}
