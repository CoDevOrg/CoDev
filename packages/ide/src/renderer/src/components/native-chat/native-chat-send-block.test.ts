import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  providerBlocked: false,
  embedded: true,
  reachability: 'connected' as 'connecting' | 'connected' | 'unreachable',
  toastError: vi.fn()
}))

vi.mock('@/web/codev-provider-readiness', () => ({
  getCodevProviderReadiness: () => ({ reason: 'Connect Claude in Settings.' }),
  isAgentSendBlocked: () => mocks.providerBlocked
}))
vi.mock('@/web/codev-embedded', () => ({ isCodevEmbedded: () => mocks.embedded }))
vi.mock('@/web/codev-runtime-reachability', () => ({
  getCodevRuntimeReachability: () => mocks.reachability
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

import { nativeChatSendBlocked } from './native-chat-send-block'

afterEach(() => {
  mocks.providerBlocked = false
  mocks.embedded = true
  mocks.reachability = 'connected'
  mocks.toastError.mockReset()
})

describe('nativeChatSendBlocked', () => {
  it('lets a send through while the workspace is reachable', () => {
    expect(nativeChatSendBlocked()).toBe(false)
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('lets a send wait out a connection that is still coming up', () => {
    mocks.reachability = 'connecting'
    expect(nativeChatSendBlocked()).toBe(false)
  })

  it('blocks and explains a send to an unreachable workspace', async () => {
    mocks.reachability = 'unreachable'
    expect(nativeChatSendBlocked()).toBe(true)
    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("Can't reach your workspace", expect.anything())
    )
  })

  it('ignores runtime reachability outside CoDev', () => {
    mocks.embedded = false
    mocks.reachability = 'unreachable'
    expect(nativeChatSendBlocked()).toBe(false)
  })

  it('names the missing provider first when nothing can run', async () => {
    mocks.providerBlocked = true
    mocks.reachability = 'unreachable'
    expect(nativeChatSendBlocked()).toBe(true)
    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('No agent is set up for this workspace', {
        description: 'Connect Claude in Settings.'
      })
    )
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
  })
})
