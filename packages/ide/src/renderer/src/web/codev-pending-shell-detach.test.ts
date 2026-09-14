import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  stored: { id: 'web-other-workspace' } as unknown,
  clears: 0
}))

vi.mock('./web-runtime-environment', () => ({
  readStoredWebRuntimeEnvironment: () => mocks.stored,
  clearStoredWebRuntimeEnvironment: () => {
    mocks.clears += 1
    mocks.stored = null
  }
}))

import { detachStoredEnvironmentForPendingShell } from './codev-pending-shell'

describe('detachStoredEnvironmentForPendingShell', () => {
  it('clears the stored pairing once and keeps it only for re-pair continuity', () => {
    expect(detachStoredEnvironmentForPendingShell()).toEqual({ id: 'web-other-workspace' })
    expect(mocks.stored).toBeNull()
    expect(detachStoredEnvironmentForPendingShell()).toEqual({ id: 'web-other-workspace' })
    expect(mocks.clears).toBe(1)
  })
})
