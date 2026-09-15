import { describe, expect, it, vi } from 'vitest'
import { ORCA_RENDERER_UNLOAD_PREVENTED_EVENT } from '../shared/renderer-shutdown-events'
import { ORCA_APP_RESTART_ABORTED_EVENT } from '../shared/updater-renderer-events'
import { registerRendererRestartIpcRelays } from './renderer-restart-wiring'

describe('renderer restart wiring', () => {
  it('relays prevented unload events as an aborted app restart', () => {
    const eventTarget = new EventTarget()
    const unloadPrevented = vi.fn()
    const restartAborted = vi.fn()
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const ipcRenderer = {
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        listeners.set(channel, listener)
        return ipcRenderer
      })
    } as unknown as Parameters<typeof registerRendererRestartIpcRelays>[0]
    eventTarget.addEventListener(ORCA_RENDERER_UNLOAD_PREVENTED_EVENT, unloadPrevented)
    eventTarget.addEventListener(ORCA_APP_RESTART_ABORTED_EVENT, restartAborted)

    registerRendererRestartIpcRelays(ipcRenderer, eventTarget)
    listeners.get('window:unload-prevented')?.({})

    expect(ipcRenderer.on).toHaveBeenCalledTimes(1)
    expect(unloadPrevented).toHaveBeenCalledTimes(1)
    expect(restartAborted).toHaveBeenCalledTimes(1)
  })
})
