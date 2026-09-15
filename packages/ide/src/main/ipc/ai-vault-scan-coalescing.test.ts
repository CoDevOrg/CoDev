import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiVaultListResult } from '../../shared/ai-vault-types'

const mocks = vi.hoisted(() => ({
  scanAiVaultSessions: vi.fn(),
  scanRuntimeAiVaultSessions: vi.fn(),
  ipcHandle: vi.fn()
}))

vi.mock('electron', () => ({ app: { on: vi.fn() }, ipcMain: { handle: mocks.ipcHandle } }))
vi.mock('../ai-vault/session-scanner', () => ({
  scanAiVaultSessions: mocks.scanAiVaultSessions
}))
vi.mock('../wsl', () => ({
  getWslHomeAsync: vi.fn(),
  listWslDistrosAsync: vi.fn().mockResolvedValue([])
}))
const { _internals, registerAiVaultHandlers } = await import('./ai-vault')
const EMPTY_RESULT: AiVaultListResult = {
  sessions: [],
  issues: [],
  scannedAt: '2026-07-27T00:00:00.000Z'
}

beforeEach(() => {
  vi.clearAllMocks()
  _internals.resetAiVaultCacheForTests()
  mocks.scanAiVaultSessions.mockResolvedValue(EMPTY_RESULT)
  mocks.scanRuntimeAiVaultSessions.mockResolvedValue(EMPTY_RESULT)
})

describe('Agent Session History scan coalescing', () => {
  it.each([
    ['local', mocks.scanAiVaultSessions],
    ['runtime:remote-server', mocks.scanRuntimeAiVaultSessions]
  ] as const)('coalesces %s scans while isolating caller cancellation', async (scope, scan) => {
    let resolveScan: ((result: AiVaultListResult) => void) | undefined
    scan.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveScan = resolve
        })
    )
    registerRuntimeHost()
    const firstController = new AbortController()
    const first = _internals.listAiVaultSessions(
      { executionHostScope: scope },
      { signal: firstController.signal }
    )
    const second = _internals.listAiVaultSessions({ executionHostScope: scope })
    await vi.waitFor(() => expect(resolveScan).toBeDefined())

    firstController.abort()

    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(scan).toHaveBeenCalledTimes(1)
    resolveScan?.(EMPTY_RESULT)
    await expect(second).resolves.toEqual(EMPTY_RESULT)
  })

  it('coalesces every all-host leg while isolating caller cancellation', async () => {
    let resolveRuntime: ((result: AiVaultListResult) => void) | undefined
    mocks.scanRuntimeAiVaultSessions.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRuntime = resolve
        })
    )
    registerRuntimeHost()
    const controller = new AbortController()

    const first = _internals.listAiVaultSessions(
      { executionHostScope: 'all' },
      { signal: controller.signal }
    )
    const firstRejection = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    const second = _internals.listAiVaultSessions({ executionHostScope: 'all' })
    await vi.waitFor(() => expect(resolveRuntime).toBeDefined())

    // Why: the local leg starts after async host discovery, so wait for it rather than racing it.
    await vi.waitFor(() => expect(mocks.scanAiVaultSessions).toHaveBeenCalledTimes(1))
    expect(mocks.scanRuntimeAiVaultSessions).toHaveBeenCalledTimes(1)
    controller.abort()
    await firstRejection
    resolveRuntime?.(EMPTY_RESULT)
    await expect(second).resolves.toMatchObject({ sessions: [], issues: [] })
  })

  it('still rejects the handler when a scan fails for a non-cancellation reason', async () => {
    mocks.scanAiVaultSessions.mockRejectedValue(new Error('transcript root is unreadable'))
    registerAiVaultHandlers()
    const list = ipcHandler('aiVault:listSessions')

    await expect(
      list({ sender: { id: 1 } }, { executionHostScope: 'local', requestToken: 'scan' })
    ).rejects.toThrow('transcript root is unreadable')
  })

})

function registerRuntimeHost(): void {
  registerAiVaultHandlers({
    getActiveRuntimeAiVaultHostInfos: () => [
      { environmentId: 'remote-server', executionHostId: 'runtime:remote-server' }
    ],
    scanRuntimeAiVaultSessions: mocks.scanRuntimeAiVaultSessions
  })
}

function ipcHandler(channel: string): (...args: unknown[]) => unknown {
  const registration = mocks.ipcHandle.mock.calls.find(([registered]) => registered === channel)
  if (!registration) {
    throw new Error(`${channel} was not registered`)
  }
  return registration[1]
}
