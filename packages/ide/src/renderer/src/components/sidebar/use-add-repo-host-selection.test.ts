import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ReactModule from 'react'
import type { SidebarHostOption } from './sidebar-host-options'

const mocks = vi.hoisted(() => ({
  stateValues: [] as unknown[],
  stateSetters: [] as ReturnType<typeof vi.fn>[],
  stateIndex: 0,
  refValues: [] as unknown[],
  refIndex: 0,
  hostOptions: [] as SidebarHostOption[],
  storeState: {
    settings: { activeRuntimeEnvironmentId: null as string | null },
    setActiveRuntimeEnvironmentPreference: vi.fn(),
    setSshConnectionState: vi.fn(),
    sshConnectionStates: new Map(),
    runtimeEnvironments: [] as { id: string; name: string; source?: 'manual' | 'ephemeral-vm' }[]
  },
  sshConnect: vi.fn(),
  sshGetState: vi.fn()
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>()
  return {
    ...actual,
    useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
    useMemo: <T>(factory: () => T) => factory(),
    useEffect: (effect: () => void | (() => void)) => {
      effect()
    },
    useRef: <T>(value: T) => {
      const index = mocks.refIndex++
      return {
        current: index in mocks.refValues ? (mocks.refValues[index] as T) : value
      }
    },
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

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mocks.storeState) => unknown) => selector(mocks.storeState)
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn()
  }
}))

vi.mock('./use-sidebar-host-scope-options', () => ({
  useSidebarHostScopeOptions: () => ({ hostOptions: mocks.hostOptions })
}))

describe('useAddRepoHostSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.stateIndex = 0
    mocks.stateSetters = []
    mocks.refIndex = 0
    mocks.refValues = []
    mocks.hostOptions = [
      {
        id: 'local',
        label: 'Local Mac',
        detail: 'This computer',
        kind: 'local',
        health: 'local',
        presence: 'local'
      },
      {
        id: 'runtime:env-1',
        label: 'Server',
        detail: 'Runtime',
        kind: 'runtime',
        health: 'available',
        presence: 'active'
      }
    ]
    mocks.storeState.settings = { activeRuntimeEnvironmentId: null }
    mocks.storeState.setActiveRuntimeEnvironmentPreference.mockResolvedValue(true)
    mocks.storeState.sshConnectionStates = new Map()
    mocks.storeState.runtimeEnvironments = []
    mocks.sshConnect.mockReset()
    mocks.sshGetState.mockReset()
    vi.stubGlobal('window', {
      api: {
        ssh: {
          connect: mocks.sshConnect,
          getState: mocks.sshGetState
        }
      }
    })
  })

  it('selects a runtime host without changing the durable active server', async () => {
    mocks.stateValues = ['local', false]
    const setStep = vi.fn()
    const { useAddRepoHostSelection } = await import('./use-add-repo-host-selection')

    const result = useAddRepoHostSelection({ isOpen: true, setStep })
    await result.handleSelectAddProjectHost('runtime:env-1')

    expect(mocks.storeState.setActiveRuntimeEnvironmentPreference).not.toHaveBeenCalled()
    expect(mocks.stateSetters[0]).toHaveBeenCalledWith('runtime:env-1')
    expect(setStep).toHaveBeenCalledWith('add')
  })

  it('does not select a disconnected SSH host', async () => {
    mocks.stateValues = ['local', false]
    mocks.hostOptions[1] = {
      ...mocks.hostOptions[1],
      health: 'disconnected'
    }
    const setStep = vi.fn()
    const { useAddRepoHostSelection } = await import('./use-add-repo-host-selection')

    const result = useAddRepoHostSelection({ isOpen: true, setStep })
    await result.handleSelectAddProjectHost('ssh:ssh-1')

    expect(mocks.storeState.setActiveRuntimeEnvironmentPreference).not.toHaveBeenCalled()
    expect(mocks.stateSetters[0]).not.toHaveBeenCalledWith('ssh:ssh-1')
    expect(setStep).not.toHaveBeenCalled()
  })

  it('does not auto-select the active runtime host while it is unavailable', async () => {
    mocks.stateValues = ['local', false]
    mocks.hostOptions[2] = {
      ...mocks.hostOptions[2],
      health: 'blocked'
    }
    mocks.storeState.settings = { activeRuntimeEnvironmentId: 'env-1' }
    const { useAddRepoHostSelection } = await import('./use-add-repo-host-selection')

    useAddRepoHostSelection({ isOpen: true, setStep: vi.fn() })

    expect(mocks.stateSetters[0]).toHaveBeenCalledWith('local')
  })

})
