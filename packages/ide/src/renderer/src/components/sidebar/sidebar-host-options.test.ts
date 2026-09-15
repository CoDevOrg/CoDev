import { describe, expect, it } from 'vitest'
import { getExecutionHostLabel } from '../../../../shared/execution-host'
import {
  buildSidebarHostOptions,
  buildSidebarHostScopeOptions,
  getSidebarHostHealthLabel,
  shouldShowHostScopeControls
} from './sidebar-host-options'

const LOCAL_HOST_LABEL = getExecutionHostLabel('local')

describe('sidebar host options', () => {
  it('hides host controls for local-only workspaces', () => {
    const hosts = buildSidebarHostOptions({
      repos: [{ connectionId: null }],
      settings: { activeRuntimeEnvironmentId: null }
    })

    expect(hosts).toEqual([
      {
        id: 'local',
        label: LOCAL_HOST_LABEL,
        detail: 'This computer',
        kind: 'local',
        health: 'local',
        presence: 'local'
      }
    ])
    expect(shouldShowHostScopeControls(hosts)).toBe(false)
  })

  it('includes the focused runtime compatibility host', () => {
    const hosts = buildSidebarHostOptions({
      repos: [],
      settings: { activeRuntimeEnvironmentId: 'runtime-1' }
    })

    expect(hosts.map((host) => host.id)).toEqual(['local', 'runtime:runtime-1'])
    // Without live status the focused runtime has no proof of reachability, so it
    // reads 'disconnected' rather than defaulting to 'available'/"Connected".
    expect(hosts.find((host) => host.id === 'runtime:runtime-1')).toMatchObject({
      detail: 'Orca server',
      health: 'disconnected'
    })
  })

  it('uses saved runtime environment names for runtime host labels', () => {
    const hosts = buildSidebarHostOptions({
      repos: [],
      settings: { activeRuntimeEnvironmentId: '03ef704c-b180-4b10-998d-e28fbd5de9a3' },
      runtimeEnvironments: [
        {
          id: '03ef704c-b180-4b10-998d-e28fbd5de9a3',
          name: 'dev box'
        }
      ]
    })

    expect(hosts.find((host) => host.id.startsWith('runtime:'))).toMatchObject({
      label: 'dev box',
      detail: 'Orca server'
    })
  })

  it('marks a runtime host blocked when its live status fails compat', () => {
    const hosts = buildSidebarHostOptions({
      repos: [],
      settings: { activeRuntimeEnvironmentId: 'runtime-1' },
      // Why: protocol 0 is below the minimum compatible server version, so the
      // registry must surface a 'server-too-old' blocked verdict + health when
      // the live status map is passed.
      runtimeStatusByEnvironmentId: new Map([
        [
          'runtime-1',
          {
            status: {
              runtimeId: 'rt',
              rendererGraphEpoch: 0,
              graphStatus: 'ready',
              authoritativeWindowId: null,
              liveTabCount: 0,
              liveLeafCount: 0,
              runtimeProtocolVersion: 0,
              minCompatibleRuntimeClientVersion: 0
            }
          }
        ]
      ])
    })

    const runtimeHost = hosts.find((host) => host.id === 'runtime:runtime-1')
    expect(runtimeHost?.health).toBe('blocked')
    expect(runtimeHost?.compatibility).toMatchObject({
      kind: 'blocked',
      reason: 'server-too-old'
    })
  })

  it('leaves a runtime host available when its live status is compatible', () => {
    const hosts = buildSidebarHostOptions({
      repos: [],
      settings: { activeRuntimeEnvironmentId: 'runtime-1' },
      runtimeStatusByEnvironmentId: new Map([
        [
          'runtime-1',
          {
            status: {
              runtimeId: 'rt',
              rendererGraphEpoch: 0,
              graphStatus: 'ready',
              authoritativeWindowId: null,
              liveTabCount: 0,
              liveLeafCount: 0,
              runtimeProtocolVersion: 3,
              minCompatibleRuntimeClientVersion: 3
            }
          }
        ]
      ])
    })

    const runtimeHost = hosts.find((host) => host.id === 'runtime:runtime-1')
    expect(runtimeHost?.health).toBe('available')
    expect(runtimeHost?.compatibility?.kind).toBe('ok')
  })

  it('builds all-host plus focused-host scope options', () => {
    const hosts = buildSidebarHostOptions({
      repos: [{ connectionId: 'ssh-1' }],
      settings: { activeRuntimeEnvironmentId: null }
    })

    expect(buildSidebarHostScopeOptions(hosts)).toMatchObject([
      { id: 'all', label: 'All hosts', detail: `${LOCAL_HOST_LABEL}, Builder`, health: 'mixed' },
      { id: 'local', label: LOCAL_HOST_LABEL, health: 'local' },
      { id: 'ssh:ssh-1', label: 'Builder', health: 'disconnected' }
    ])
  })

  it('labels host health for compact sidebar UI', () => {
    expect(getSidebarHostHealthLabel('available')).toBe('Connected')
    expect(getSidebarHostHealthLabel('connecting')).toBe('Connecting')
    expect(getSidebarHostHealthLabel('blocked')).toBe('Update needed')
    expect(getSidebarHostHealthLabel('error')).toBe('Needs attention')
  })
})
