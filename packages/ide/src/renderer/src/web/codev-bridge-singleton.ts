import {
  createCodevBridge,
  type CodevBridgeCommand,
  type CodevBridgeHost,
  type CodevBridgeRequestMethod,
  type CodevBridgeSnapshot
} from './codev-bridge'

export type { CodevBridgeCommand, CodevBridgeRequestMethod, CodevBridgeSnapshot }

let singleton: ReturnType<typeof createCodevBridge> | null = null

function ensureCodevBridge(
  host: CodevBridgeHost = window as CodevBridgeHost
): ReturnType<typeof createCodevBridge> {
  if (!singleton) {
    singleton = createCodevBridge(host)
  }
  return singleton
}

export function startCodevBridge(host: CodevBridgeHost = window as CodevBridgeHost): void {
  ensureCodevBridge(host).start()
}

export function getCodevBridgeSnapshot(): CodevBridgeSnapshot {
  return ensureCodevBridge().getSnapshot()
}

export function subscribeCodevBridge(listener: () => void): () => void {
  return ensureCodevBridge().subscribe(listener)
}

export function subscribeCodevBridgeCommand(
  listener: (command: CodevBridgeCommand) => void
): () => void {
  return ensureCodevBridge().subscribeCommand(listener)
}

export function interruptCodevBridge(): void {
  singleton?.interrupt()
}

export function reconnectCodevBridge(): void {
  singleton?.reconnect()
}

export function requestCodevBridge<T = unknown>(
  method: CodevBridgeRequestMethod,
  params?: Record<string, unknown>
): Promise<T> {
  return ensureCodevBridge().request(method, params) as Promise<T>
}

export function resetCodevBridgeForTests(): void {
  singleton?.dispose()
  singleton = null
}
