import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCodevBridge } from './codev-bridge'

type Posted = { data: Record<string, unknown> & { type: string; generation: number }; origin: string }

function createHost() {
  const listeners = new Set<(event: MessageEvent) => void>()
  const posted: Posted[] = []
  const host = {
    __CODEV_EMBEDDED__: true,
    location: { origin: 'https://codev.example' },
    parent: {
      postMessage(data: unknown, origin: string) {
        posted.push({ data: data as Posted['data'], origin })
      }
    },
    addEventListener(_type: string, listener: EventListener) {
      listeners.add(listener as (event: MessageEvent) => void)
    },
    removeEventListener(_type: string, listener: EventListener) {
      listeners.delete(listener as (event: MessageEvent) => void)
    }
  }
  return {
    host,
    posted,
    ack(generation = posted.at(-1)?.data.generation ?? 1) {
      const event = {
        origin: 'https://codev.example',
        data: { type: 'codev:bridge-hello-ack', generation, workspaceBound: true }
      } as MessageEvent
      for (const listener of listeners) {
        listener(event)
      }
    },
    respond(data: Record<string, unknown>) {
      const event = {
        origin: 'https://codev.example',
        data
      } as MessageEvent
      for (const listener of listeners) {
        listener(event)
      }
    }
  }
}

describe('createCodevBridge', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows connected status after a workspace-bound hello ack', () => {
    const { host, posted, ack } = createHost()
    const bridge = createCodevBridge(host)

    bridge.start()
    expect(bridge.getSnapshot().label).toBe('CoDev · Reconnecting')
    expect(posted[0]).toEqual({
      data: { type: 'codev:bridge-hello', generation: 1 },
      origin: 'https://codev.example'
    })

    ack()
    expect(bridge.getSnapshot()).toMatchObject({
      status: 'connected',
      label: 'CoDev · Connected'
    })
    bridge.dispose()
  })

  it('interrupts the bridge and recovers after reconnect', () => {
    const { host, posted, ack } = createHost()
    const bridge = createCodevBridge(host)
    bridge.start()
    ack()

    bridge.interrupt()
    expect(posted.at(-1)?.data).toEqual({ type: 'codev:bridge-interrupt', generation: 1 })
    expect(bridge.getSnapshot().label).toBe('CoDev · Disconnected')

    bridge.reconnect()
    expect(posted.at(-1)?.data).toEqual({ type: 'codev:bridge-hello', generation: 2 })
    ack(2)
    expect(bridge.getSnapshot().status).toBe('connected')
    bridge.dispose()
  })

  it('returns a referentially stable snapshot while status is unchanged', () => {
    const { host, ack } = createHost()
    const bridge = createCodevBridge(host)
    expect(bridge.getSnapshot()).toBe(bridge.getSnapshot())

    bridge.start()
    expect(bridge.getSnapshot()).toBe(bridge.getSnapshot())
    expect(bridge.getSnapshot().status).toBe('reconnecting')

    ack()
    const connected = bridge.getSnapshot()
    expect(connected).toBe(bridge.getSnapshot())
    expect(connected.status).toBe('connected')
    bridge.dispose()
  })

  it('creates and revokes invites over the connected request bridge', async () => {
    const { host, posted, ack, respond } = createHost()
    const bridge = createCodevBridge(host)
    bridge.start()
    ack()

    const inviteId = 'c1f9fe13-6881-44a6-adbd-96bc5a946afa'
    const createdPromise = bridge.request('invites.create', { accessRole: 'reviewer' })
    const createRequest = posted.at(-1)?.data as unknown as {
      type: string
      requestId: string
      method: string
      params?: Record<string, unknown>
    }
    expect(createRequest).toMatchObject({
      type: 'codev:bridge-request',
      method: 'invites.create',
      params: { accessRole: 'reviewer' }
    })
    respond({
      type: 'codev:bridge-response',
      generation: 1,
      requestId: createRequest.requestId,
      ok: true,
      result: { inviteId, status: 'pending' }
    })
    await expect(createdPromise).resolves.toEqual({ inviteId, status: 'pending' })

    const revokedPromise = bridge.request('invites.revoke', { inviteId })
    const revokeRequest = posted.at(-1)?.data as unknown as { requestId: string; method: string }
    expect(revokeRequest.method).toBe('invites.revoke')
    respond({
      type: 'codev:bridge-response',
      generation: 1,
      requestId: revokeRequest.requestId,
      ok: true,
      result: {
        revokedInviteId: inviteId,
        invites: [{ inviteId, status: 'revoked' }],
        members: [{ login: 'alex', name: 'Alex Morgan', accessRole: 'owner' }]
      }
    })
    await expect(revokedPromise).resolves.toMatchObject({
      revokedInviteId: inviteId,
      invites: [{ status: 'revoked' }]
    })
    bridge.dispose()
  })

  it('delivers a parent-initiated command to subscribers once connected', () => {
    const { host, ack, respond } = createHost()
    const bridge = createCodevBridge(host)
    bridge.start()
    ack()

    const received: unknown[] = []
    const unsubscribe = bridge.subscribeCommand((command) => received.push(command))

    respond({
      type: 'codev:bridge-command',
      generation: 1,
      command: { kind: 'terminal-run', command: 'codex resume abc-123' }
    })

    expect(received).toEqual([{ kind: 'terminal-run', command: 'codex resume abc-123' }])
    unsubscribe()
    bridge.dispose()
  })

  it('delivers the optional agent tag through to subscribers', () => {
    const { host, ack, respond } = createHost()
    const bridge = createCodevBridge(host)
    bridge.start()
    ack()

    const received: unknown[] = []
    bridge.subscribeCommand((command) => received.push(command))

    respond({
      type: 'codev:bridge-command',
      generation: 1,
      command: { kind: 'terminal-run', command: 'codex resume abc-123', agent: 'codex' }
    })

    expect(received).toEqual([
      { kind: 'terminal-run', command: 'codex resume abc-123', agent: 'codex' }
    ])
    bridge.dispose()
  })

  it('ignores a command from a stale generation', () => {
    const { host, ack, respond } = createHost()
    const bridge = createCodevBridge(host)
    bridge.start()
    ack()

    const received: unknown[] = []
    bridge.subscribeCommand((command) => received.push(command))

    respond({
      type: 'codev:bridge-command',
      generation: 999,
      command: { kind: 'terminal-run', command: 'codex resume abc-123' }
    })

    expect(received).toEqual([])
    bridge.dispose()
  })

  it('ignores a malformed command payload', () => {
    const { host, ack, respond } = createHost()
    const bridge = createCodevBridge(host)
    bridge.start()
    ack()

    const received: unknown[] = []
    bridge.subscribeCommand((command) => received.push(command))

    respond({ type: 'codev:bridge-command', generation: 1, command: { kind: 'terminal-run' } })
    respond({
      type: 'codev:bridge-command',
      generation: 1,
      command: { kind: 'something-else', command: 'rm -rf /' }
    })
    respond({ type: 'codev:bridge-command', generation: 1, command: 'codex resume abc-123' })
    respond({
      type: 'codev:bridge-command',
      generation: 1,
      command: { kind: 'terminal-run', command: 'codex resume abc-123', agent: 42 }
    })

    expect(received).toEqual([])
    bridge.dispose()
  })

  it('stops delivering commands to an unsubscribed listener', () => {
    const { host, ack, respond } = createHost()
    const bridge = createCodevBridge(host)
    bridge.start()
    ack()

    const received: unknown[] = []
    const unsubscribe = bridge.subscribeCommand((command) => received.push(command))
    unsubscribe()

    respond({
      type: 'codev:bridge-command',
      generation: 1,
      command: { kind: 'terminal-run', command: 'codex resume abc-123' }
    })

    expect(received).toEqual([])
    bridge.dispose()
  })
})
