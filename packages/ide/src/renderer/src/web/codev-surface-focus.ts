import { useSyncExternalStore } from 'react'

/**
 * A request for one CoDev surface to focus a particular thing.
 *
 * The activity feed's jump controls used to switch the sidebar tab and stop:
 * "Open Agents · session" landed on the agents panel with nothing selected,
 * and "Open Checks · diff" on whatever checkpoint the panel already showed.
 * The target lives here, outside the persisted app store, so the panel that
 * owns the surface can pick it up when it mounts or on its next render, act
 * on it once, and clear it.
 */
export type CodevSurfaceFocusTarget =
  | { kind: 'mission-control-agent'; sessionId: string }
  | { kind: 'review-checkpoint'; sessionId: string }

export type CodevSurfaceFocusRequest = { id: number; target: CodevSurfaceFocusTarget }

let current: CodevSurfaceFocusRequest | null = null
let nextId = 1
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function subscribeCodevSurfaceFocus(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Replaces any pending request; only the latest jump matters. */
export function requestCodevSurfaceFocus(target: CodevSurfaceFocusTarget): number {
  current = { id: nextId++, target }
  emit()
  return current.id
}

/** Marks a request handled. A newer request is left alone. */
export function consumeCodevSurfaceFocus(id: number): void {
  if (current?.id !== id) {
    return
  }
  current = null
  emit()
}

export function getCodevSurfaceFocus<K extends CodevSurfaceFocusTarget['kind']>(
  kind: K
): (CodevSurfaceFocusRequest & { target: Extract<CodevSurfaceFocusTarget, { kind: K }> }) | null {
  return current?.target.kind === kind
    ? (current as CodevSurfaceFocusRequest & {
        target: Extract<CodevSurfaceFocusTarget, { kind: K }>
      })
    : null
}

export function useCodevSurfaceFocus<K extends CodevSurfaceFocusTarget['kind']>(
  kind: K
): ReturnType<typeof getCodevSurfaceFocus<K>> {
  return useSyncExternalStore(
    subscribeCodevSurfaceFocus,
    () => getCodevSurfaceFocus(kind),
    () => getCodevSurfaceFocus(kind)
  )
}

/** Test seam. */
export function resetCodevSurfaceFocusForTest(): void {
  current = null
  nextId = 1
  listeners.clear()
}
