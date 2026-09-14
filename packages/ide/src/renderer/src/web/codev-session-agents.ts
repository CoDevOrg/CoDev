import type { TuiAgent } from '../../../shared/types'

/** The only agents a CoDev member can start a session with. */
export const CODEV_SESSION_AGENTS: readonly TuiAgent[] = ['claude', 'codex', 'cursor']

export function codevSessionAgents<T extends { id: TuiAgent }>(catalog: readonly T[]): T[] {
  return catalog.filter((entry) => CODEV_SESSION_AGENTS.includes(entry.id))
}
