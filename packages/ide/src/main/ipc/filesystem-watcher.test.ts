import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock, getSshFilesystemProviderMock, providerRegistrationListeners } = vi.hoisted(
  () => ({
    handleMock: vi.fn(),
    getSshFilesystemProviderMock: vi.fn(),
    providerRegistrationListeners: new Set<(connectionId: string) => void>()
  })
)

/** Drive the provider-registration hook the way a relay establish/reconnect would. */
function emitProviderRegistered(connectionId: string): void {
  for (const listener of providerRegistrationListeners) {
    listener(connectionId)
  }
}

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock
  }
}))

vi.mock('fs/promises', () => ({
  stat: vi.fn()
}))

vi.mock('@parcel/watcher', () => ({
  subscribe: vi.fn()
}))

vi.mock('./filesystem-watcher-wsl', () => ({
  createWslWatcher: vi.fn()
}))

import {
  closeAllWatchers,
  closeRemoteWatcherForWorktreePath,
  forgetRemoteWatcherRemovalSnapshot,
  registerFilesystemWatcherHandlers,
  restoreRemoteWatcherAfterFailedRemoval
} from './filesystem-watcher'
import { stat } from 'node:fs/promises'
import { subscribe as subscribeParcelWatcher } from '@parcel/watcher'
import { createWslWatcher } from './filesystem-watcher-wsl'
import {
  MAX_PHYSICAL_WATCHER_CHILDREN,
  reserveWatcherChild,
  resetWatcherChildRegistryForTest,
  WatcherChildCapacityError
} from './parcel-watcher-child-registry'
import { acquireWatcherRemovalGate } from './watcher-removal-gate'
import { WATCH_BATCH_TRAILING_MS } from '../../shared/filesystem-watch-batch-window'

type HandlerMap = Record<string, (_event: unknown, args: unknown) => Promise<unknown> | unknown>

/** Remote fs:changed rides the shared debounce window, so drain it before asserting sends. */
const emitRemote = async (onEvents: (e: unknown[]) => void, events: unknown[]) => {
  onEvents(events)
  await (vi.isFakeTimers()
    ? vi.advanceTimersByTimeAsync(WATCH_BATCH_TRAILING_MS)
    : new Promise((resolve) => setTimeout(resolve, WATCH_BATCH_TRAILING_MS + 25)))
}

describe('registerFilesystemWatcherHandlers', () => {
  const handlers: HandlerMap = {}
  const originalPlatform = process.platform

  beforeEach(async () => {
    vi.useRealTimers()
    handleMock.mockReset()
    getSshFilesystemProviderMock.mockReset()
    vi.mocked(stat).mockReset()
    vi.mocked(subscribeParcelWatcher).mockReset()
    vi.mocked(createWslWatcher).mockReset()
    resetWatcherChildRegistryForTest()
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: originalPlatform
    })
    for (const key of Object.keys(handlers)) {
      delete handlers[key]
    }
    handleMock.mockImplementation((channel, handler) => {
      handlers[channel] = handler
    })
    registerFilesystemWatcherHandlers()
    await closeAllWatchers()
  })

  it('pins Parcel to the Windows backend for local Windows watches', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    })
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as never)
    vi.mocked(subscribeParcelWatcher).mockResolvedValue({ unsubscribe: vi.fn() } as never)

    await handlers['fs:watchWorktree'](
      { sender: { isDestroyed: () => false, send: vi.fn(), once: vi.fn(), id: 1 } },
      { worktreePath: 'C:\\repo' }
    )

    expect(subscribeParcelWatcher).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Function),
      expect.objectContaining({ backend: 'windows' })
    )

    await closeAllWatchers()
  })

  it('automatically retries a WSL watcher when child capacity becomes available', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    })
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as never)
    const heldReservations = Array.from({ length: MAX_PHYSICAL_WATCHER_CHILDREN }, () =>
      reserveWatcherChild()
    )
    vi.mocked(createWslWatcher).mockImplementation(async (_rootKey, worktreePath) => {
      const release = reserveWatcherChild()
      if (!release) {
        throw new WatcherChildCapacityError()
      }
      return {
        subscription: { unsubscribe: vi.fn(async () => release()) },
        listeners: new Map(),
        batch: { events: [], overflowed: false, timer: null, firstEventAt: 0 },
        rootPath: worktreePath
      }
    })
    const sender = { isDestroyed: () => false, send: vi.fn(), once: vi.fn(), id: 1 }
    const args = { worktreePath: '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo' }

    await expect(handlers['fs:watchWorktree']({ sender }, args)).resolves.toBeUndefined()
    expect(createWslWatcher).toHaveBeenCalledOnce()

    heldReservations.pop()?.()
    await vi.waitFor(() => expect(createWslWatcher).toHaveBeenCalledTimes(2))
    await closeAllWatchers()
    heldReservations.forEach((release) => release?.())
  })

  it('cancels a pending WSL capacity retry when the renderer unwatches', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    })
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as never)
    const heldReservations = Array.from({ length: MAX_PHYSICAL_WATCHER_CHILDREN }, () =>
      reserveWatcherChild()
    )
    vi.mocked(createWslWatcher).mockRejectedValue(new WatcherChildCapacityError())
    const sender = { isDestroyed: () => false, send: vi.fn(), once: vi.fn(), id: 1 }
    const args = { worktreePath: '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo' }

    await handlers['fs:watchWorktree']({ sender }, args)
    handlers['fs:unwatchWorktree']({ sender: { id: sender.id } }, args)
    heldReservations.pop()?.()
    await Promise.resolve()
    await Promise.resolve()

    expect(createWslWatcher).toHaveBeenCalledOnce()
    heldReservations.forEach((release) => release?.())
  })

  it('rejects installs during destructive removal and allows a retry afterward', async () => {
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as never)
    vi.mocked(subscribeParcelWatcher).mockResolvedValue({ unsubscribe: vi.fn() } as never)
    const sender = { isDestroyed: () => false, send: vi.fn(), once: vi.fn(), id: 1 }
    const removal = acquireWatcherRemovalGate('/repo')
    await removal.ready

    await expect(
      handlers['fs:watchWorktree']({ sender }, { worktreePath: '/repo' })
    ).rejects.toMatchObject({ code: 'watcher_removal_in_progress' })
    expect(subscribeParcelWatcher).not.toHaveBeenCalled()

    removal.release()
    await expect(
      handlers['fs:watchWorktree']({ sender }, { worktreePath: '/repo' })
    ).resolves.toBeUndefined()
    expect(subscribeParcelWatcher).toHaveBeenCalledTimes(1)
  })

})
