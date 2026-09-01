import {
  isParentMessage,
  type CodevBridgeCommand,
  type CodevBridgeRequestMethod,
  type CodevBridgeSnapshot,
  type CodevBridgeStatus
} from './codev-bridge-protocol'

export type { CodevBridgeCommand, CodevBridgeRequestMethod, CodevBridgeSnapshot, CodevBridgeStatus }

export type CodevBridgeHost = Pick<Window, 'addEventListener' | 'removeEventListener'> & {
  __CODEV_EMBEDDED__?: boolean
  location: { origin: string }
  parent: { postMessage: (data: unknown, origin: string) => void }
}

const SNAPSHOTS: Record<CodevBridgeStatus, CodevBridgeSnapshot> = {
  connected: {
    status: 'connected',
    label: 'CoDev · Connected',
    detail: 'Workspace-bound request bridge is connected.'
  },
  reconnecting: {
    status: 'reconnecting',
    label: 'CoDev · Reconnecting',
    detail: 'Workspace-bound request bridge is recovering.'
  },
  disconnected: {
    status: 'disconnected',
    label: 'CoDev · Disconnected',
    detail: 'Workspace-bound request bridge is interrupted.'
  }
}

function snapshotFor(status: CodevBridgeStatus): CodevBridgeSnapshot {
  return SNAPSHOTS[status]
}

export function createCodevBridge(host: CodevBridgeHost): {
  getSnapshot: () => CodevBridgeSnapshot
  subscribe: (listener: () => void) => () => void
  subscribeCommand: (listener: (command: CodevBridgeCommand) => void) => () => void
  start: () => void
  request: (method: CodevBridgeRequestMethod, params?: Record<string, unknown>) => Promise<unknown>
  interrupt: () => void
  reconnect: () => void
  dispose: () => void
} {
  let generation = 0
  let status: CodevBridgeStatus = 'disconnected'
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let pongTimer: ReturnType<typeof setTimeout> | null = null
  let helloTimer: ReturnType<typeof setTimeout> | null = null
  let started = false
  const listeners = new Set<() => void>()
  const commandListeners = new Set<(command: CodevBridgeCommand) => void>()
  const pending = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()

  const emit = (): void => {
    for (const listener of listeners) {
      listener()
    }
  }

  const setStatus = (next: CodevBridgeStatus): void => {
    if (status === next) {
      return
    }
    status = next
    emit()
  }

  const clearTimers = (): void => {
    if (pingTimer) {
      clearInterval(pingTimer)
      pingTimer = null
    }
    if (pongTimer) {
      clearTimeout(pongTimer)
      pongTimer = null
    }
    if (helloTimer) {
      clearTimeout(helloTimer)
      helloTimer = null
    }
  }

  const rejectPending = (error: Error): void => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }

  const post = (data: Record<string, unknown> & { type: string; generation: number }): void => {
    host.parent.postMessage(data, host.location.origin)
  }

  const expectPong = (): void => {
    if (pongTimer) {
      clearTimeout(pongTimer)
    }
    pongTimer = setTimeout(() => {
      if (status !== 'connected') {
        return
      }
      setStatus('reconnecting')
      clearTimers()
      sendHello()
    }, 2500)
  }

  const startPinging = (): void => {
    if (pingTimer) {
      clearInterval(pingTimer)
    }
    pingTimer = setInterval(() => {
      if (status !== 'connected') {
        return
      }
      post({ type: 'codev:bridge-ping', generation })
      expectPong()
    }, 4000)
  }

  const sendHello = (): void => {
    generation += 1
    setStatus('reconnecting')
    post({ type: 'codev:bridge-hello', generation })
    if (helloTimer) {
      clearTimeout(helloTimer)
    }
    helloTimer = setTimeout(() => {
      if (status === 'reconnecting') {
        sendHello()
      }
    }, 2500)
  }

  const onMessage = (event: Event): void => {
    const message = event as MessageEvent
    if (message.origin !== host.location.origin || !isParentMessage(message.data, generation)) {
      return
    }
    if (message.data.type === 'codev:bridge-hello-ack') {
      if (helloTimer) {
        clearTimeout(helloTimer)
        helloTimer = null
      }
      setStatus('connected')
      startPinging()
      return
    }
    if (message.data.type === 'codev:bridge-response') {
      const pendingRequest = pending.get(message.data.requestId)
      if (!pendingRequest) {
        return
      }
      pending.delete(message.data.requestId)
      clearTimeout(pendingRequest.timer)
      if (message.data.ok) {
        pendingRequest.resolve(message.data.result)
        return
      }
      pendingRequest.reject(
        new Error(message.data.error || 'CoDev could not complete this request.')
      )
      return
    }
    if (message.data.type === 'codev:bridge-command') {
      for (const listener of commandListeners) {
        listener(message.data.command)
      }
      return
    }
    if (pongTimer) {
      clearTimeout(pongTimer)
      pongTimer = null
    }
  }

  return {
    getSnapshot: () => snapshotFor(status),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    subscribeCommand(listener) {
      commandListeners.add(listener)
      return () => {
        commandListeners.delete(listener)
      }
    },
    start() {
      if (!host.__CODEV_EMBEDDED__ || host.parent === (host as unknown as Window) || started) {
        return
      }
      started = true
      host.addEventListener('message', onMessage)
      sendHello()
    },
    request(method: CodevBridgeRequestMethod, params?: Record<string, unknown>): Promise<unknown> {
      if (!started || status !== 'connected') {
        return Promise.reject(new Error('CoDev bridge is not connected.'))
      }
      const requestId =
        globalThis.crypto && 'randomUUID' in globalThis.crypto
          ? globalThis.crypto.randomUUID()
          : `req-${Date.now()}-${Math.random().toString(16).slice(2)}`
      const currentGeneration = generation
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => {
            pending.delete(requestId)
            reject(new Error('CoDev request timed out.'))
          },
          method === 'review.prepare' || method === 'review.advance' || method === 'review.merge'
            ? 60_000
            : 15_000
        )
        pending.set(requestId, { resolve, reject, timer })
        post({
          type: 'codev:bridge-request',
          generation: currentGeneration,
          requestId,
          method,
          ...(params ? { params } : {})
        })
      })
    },
    interrupt() {
      if (!started || status === 'disconnected') {
        return
      }
      const currentGeneration = generation
      clearTimers()
      rejectPending(new Error('CoDev bridge is disconnected.'))
      post({ type: 'codev:bridge-interrupt', generation: currentGeneration })
      setStatus('disconnected')
    },
    reconnect() {
      if (!started) {
        this.start()
        return
      }
      if (status === 'connected' || status === 'reconnecting') {
        return
      }
      sendHello()
    },
    dispose() {
      clearTimers()
      rejectPending(new Error('CoDev bridge is disconnected.'))
      host.removeEventListener('message', onMessage)
      started = false
      status = 'disconnected'
    }
  }
}

