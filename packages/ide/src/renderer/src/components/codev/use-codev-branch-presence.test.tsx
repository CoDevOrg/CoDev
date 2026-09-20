// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getBridge: vi.fn(() => ({ status: 'connected', label: 'Connected', detail: '' })),
  getStreamStatus: vi.fn(() => 'connected'),
  reconnect: vi.fn(),
  request: vi.fn(),
  bridgeListeners: new Set<() => void>(),
  eventListeners: new Set<(event: { type: string }) => void>(),
  streamListeners: new Set<(status: string) => void>(),
  publishWorkboard: vi.fn()
}))

vi.mock('@/web/codev-bridge-singleton', () => ({
  getCodevBridgeSnapshot: mocks.getBridge,
  getCodevWorkspaceStreamStatus: mocks.getStreamStatus,
  reconnectCodevBridge: mocks.reconnect,
  requestCodevBridge: mocks.request,
  subscribeCodevBridge: (listener: () => void) => {
    mocks.bridgeListeners.add(listener)
    return () => mocks.bridgeListeners.delete(listener)
  },
  subscribeCodevWorkspaceEvent: (listener: (event: { type: string }) => void) => {
    mocks.eventListeners.add(listener)
    return () => mocks.eventListeners.delete(listener)
  },
  subscribeCodevWorkspaceStream: (listener: (status: string) => void) => {
    mocks.streamListeners.add(listener)
    return () => mocks.streamListeners.delete(listener)
  }
}))

vi.mock('../sidebar/codev-workboard-store', () => ({
  publishCodevWorkboard: mocks.publishWorkboard
}))

import { useCodevBranchPresence } from './use-codev-branch-presence'

function workboard() {
  return { capacity: { maxActiveSessions: 3, activeSessions: 0, availableSlots: 3 }, slots: [] }
}

function sessions() {
  return { sharedSessions: [] }
}

function roster() {
  return { viewerId: 'viewer', members: [] }
}

describe('useCodevBranchPresence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.request.mockReset()
    mocks.getBridge.mockReturnValue({ status: 'connected', label: 'Connected', detail: '' })
    mocks.getStreamStatus.mockReturnValue('connected')
    mocks.bridgeListeners.clear()
    mocks.eventListeners.clear()
    mocks.streamListeners.clear()
    mocks.publishWorkboard.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('replays an invalidation that arrives during an in-flight refresh', async () => {
    let resolveFirst!: () => void
    const firstRefresh = new Promise<void>((resolve) => {
      resolveFirst = resolve
    })
    const responseQueue = [
      firstRefresh.then(() => workboard()),
      firstRefresh.then(() => sessions()),
      firstRefresh.then(() => roster()),
      workboard(),
      sessions(),
      roster()
    ]
    mocks.request.mockImplementation(() => responseQueue.shift())

    renderHook(() => useCodevBranchPresence(true))
    await act(async () => {})
    expect(mocks.request).toHaveBeenCalledTimes(3)

    act(() => {
      for (const listener of mocks.eventListeners) {
        listener({ type: 'agents.changed' })
      }
    })
    expect(mocks.request).toHaveBeenCalledTimes(3)

    await act(async () => {
      resolveFirst()
      await firstRefresh
      await Promise.resolve()
    })
    expect(mocks.request).toHaveBeenCalledTimes(3)

    await act(async () => {
      vi.advanceTimersByTime(0)
      await Promise.resolve()
    })
    expect(mocks.request).toHaveBeenCalledTimes(6)
  })
})
