import { beforeEach, describe,   vi } from 'vitest'
import type * as ReactModule from 'react'
import type { Repo } from '../../../../shared/types'

const mocks = vi.hoisted(() => ({
  stateValues: [] as unknown[],
  stateSetters: [] as ReturnType<typeof vi.fn>[],
  stateIndex: 0,
  storeState: {
    repos: [] as Repo[],
    projects: [],
    projectHostSetups: [],
    clearOrcaHookTrustForRepo: vi.fn(),
    openModal: vi.fn(),
    cancelNestedRepoScan: vi.fn()
  },
  addRemote: vi.fn(),
  listTargets: vi.fn(),
  getState: vi.fn(),
  onStateChanged: vi.fn(() => vi.fn()),
  fetchWorktrees: vi.fn(),
  onGitRepoReady: vi.fn()
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>()
  return {
    ...actual,
    useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
    useEffect: (effect: () => void | (() => void)) => {
      effect()
    },
    useRef: <T>(value: T) => ({ current: value }),
    useState: <T>(initial: T | (() => T)) => {
      const index = mocks.stateIndex++
      const value =
        index in mocks.stateValues
          ? mocks.stateValues[index]
          : typeof initial === 'function'
            ? (initial as () => T)()
            : initial
      const setter = vi.fn()
      mocks.stateSetters[index] = setter
      return [value as T, setter]
    }
  }
})

vi.mock('@/hooks/useMountedRef', () => ({
  useMountedRef: () => ({ current: true })
}))

vi.mock('@/store', () => {
  const useAppStore = Object.assign(
    (selector: (state: typeof mocks.storeState) => unknown) => selector(mocks.storeState),
    {
      getState: () => mocks.storeState,
      setState: (next: Partial<typeof mocks.storeState>) => {
        Object.assign(mocks.storeState, next)
      }
    }
  )
  return { useAppStore }
})

vi.mock('../../../../shared/nested-repo-telemetry', () => ({
  createNestedRepoTelemetryAttemptId: () => 'attempt-1'
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn()
  }
}))

describe('useRemoteRepo default-checkout handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.stateIndex = 0
    mocks.stateSetters = []
    mocks.stateValues = [[], 'ssh-1', '/srv/repo', null, false, null]
    mocks.storeState.repos = []
    mocks.storeState.projects = []
    mocks.storeState.projectHostSetups = []
    mocks.listTargets.mockResolvedValue([
      { id: 'ssh-1', label: 'Builder 1' },
      { id: 'ssh-2', label: 'Builder 2' }
    ])
    mocks.getState.mockResolvedValue({ status: 'connected' })
    vi.stubGlobal('window', {
      api: {
        ssh: {
          listTargets: mocks.listTargets,
          getState: mocks.getState,
          onStateChanged: mocks.onStateChanged
        },
        repos: {
          addRemote: mocks.addRemote
        }
      }
    })
  })

})
