import { beforeEach, describe, expect, it, vi } from 'vitest'

const ipcState = vi.hoisted(() => ({
  handleHandlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      ipcState.handleHandlers.set(channel, handler)
    }
  }
}))

import { registerRateLimitHandlers } from './rate-limits'
import type { RateLimitService } from '../rate-limits/service'
import type { RateLimitState } from '../../shared/rate-limit-types'
import type { CodexAccountService } from '../codex-accounts/service'

function makeCodexAccounts() {
  const consumeCurrentRateLimitResetCredit = vi.fn(() =>
    Promise.resolve({ outcome: 'noCredit', state: {} as RateLimitState })
  )
  return {
    service: { consumeCurrentRateLimitResetCredit } as unknown as CodexAccountService,
    consumeCurrentRateLimitResetCredit
  }
}

function makeService(): {
  service: RateLimitService
  refresh: ReturnType<typeof vi.fn>
  consumeCodexRateLimitResetCredit: ReturnType<typeof vi.fn>
} {
  const refresh = vi.fn(() => Promise.resolve({} as RateLimitState))
  const consumeCodexRateLimitResetCredit = vi.fn(() =>
    Promise.resolve({ outcome: 'noCredit', state: {} as RateLimitState })
  )
  const service = {
    getState: vi.fn(() => ({}) as RateLimitState),
    refresh,
    refreshCodexForTarget: vi.fn(() => Promise.resolve({} as RateLimitState)),
    refreshClaudeForTarget: vi.fn(() => Promise.resolve({} as RateLimitState)),
    consumeCodexRateLimitResetCredit,
    setPollingInterval: vi.fn(() => Promise.resolve()),
    fetchInactiveClaudeAccountsOnOpen: vi.fn(() => Promise.resolve()),
    fetchInactiveCodexAccountsOnOpen: vi.fn(() => Promise.resolve())
  }
  return {
    service: service as unknown as RateLimitService,
    refresh,
    consumeCodexRateLimitResetCredit
  }
}

describe('registerRateLimitHandlers', () => {
  beforeEach(() => {
    ipcState.handleHandlers.clear()
  })

  it('keeps the existing rate-limit channels registered', () => {
    const { service } = makeService()
    registerRateLimitHandlers(service, makeCodexAccounts().service)
    expect(ipcState.handleHandlers.has('rateLimits:get')).toBe(true)
    expect(ipcState.handleHandlers.has('rateLimits:refresh')).toBe(true)
  })

  it('serializes desktop reset consumption through CodexAccountService', async () => {
    const { service, consumeCodexRateLimitResetCredit } = makeService()
    const codexAccounts = makeCodexAccounts()
    registerRateLimitHandlers(service, codexAccounts.service)
    const handler = ipcState.handleHandlers.get('rateLimits:consumeCodexResetCredit')

    await handler!({})

    expect(codexAccounts.consumeCurrentRateLimitResetCredit).toHaveBeenCalledOnce()
    expect(consumeCodexRateLimitResetCredit).not.toHaveBeenCalled()
  })
})
