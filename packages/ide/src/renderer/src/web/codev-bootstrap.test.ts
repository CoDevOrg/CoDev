import { describe, expect, it } from 'vitest'
import { readCodevBootstrap } from './codev-bootstrap'

describe('readCodevBootstrap', () => {
  it('accepts a CoDev-owned workspace path', () => {
    expect(
      readCodevBootstrap({
        hash: '#pairing=secret&codev=1&codevProject=%2Fsrv%2Fcodev%2Fworkspaces%2Fc1f9fe13-6881-44a6-adbd-96bc5a946afa&codevProjectKind=git&codevProjectName=yousef20920%2FCoDev'
      } as Location)
    ).toEqual({
      projectPath: '/srv/codev/workspaces/c1f9fe13-6881-44a6-adbd-96bc5a946afa',
      projectKind: 'git',
      projectName: 'yousef20920/CoDev'
    })
  })

  it('carries a pinned default chat agent from the pairing fragment', () => {
    expect(
      readCodevBootstrap({
        hash: '#pairing=secret&codev=1&codevProject=%2Fsrv%2Fcodev%2Fworkspaces%2Fc1f9fe13-6881-44a6-adbd-96bc5a946afa&codevProjectKind=git&codevDefaultAgent=codex'
      } as Location)
    ).toEqual({
      projectPath: '/srv/codev/workspaces/c1f9fe13-6881-44a6-adbd-96bc5a946afa',
      projectKind: 'git',
      defaultAgent: 'codex'
    })
  })

  it('ignores an unknown default chat agent instead of failing the bootstrap', () => {
    expect(
      readCodevBootstrap({
        hash: '#pairing=secret&codev=1&codevProject=%2Fsrv%2Fcodev%2Fworkspaces%2Fc1f9fe13-6881-44a6-adbd-96bc5a946afa&codevProjectKind=git&codevDefaultAgent=cursor'
      } as Location)
    ).toEqual({
      projectPath: '/srv/codev/workspaces/c1f9fe13-6881-44a6-adbd-96bc5a946afa',
      projectKind: 'git'
    })
  })

  it('accepts a personal settings-only path under the shared workspace root', () => {
    expect(
      readCodevBootstrap({
        hash: '#pairing=secret&codev=1&codevProject=%2Fsrv%2Fcodev%2Fworkspaces%2Fc1f9fe13-6881-44a6-adbd-96bc5a946afa&codevProjectKind=folder&codevSettingsOnly=1'
      } as Location)
    ).toEqual({
      projectPath: '/srv/codev/workspaces/c1f9fe13-6881-44a6-adbd-96bc5a946afa',
      projectKind: 'folder',
      settingsOnly: true
    })
  })

  it('carries whether the member has a linked Cursor credential', () => {
    expect(
      readCodevBootstrap({
        hash: '#pairing=secret&codev=1&codevProject=%2Fsrv%2Fcodev%2Fworkspaces%2Fc1f9fe13-6881-44a6-adbd-96bc5a946afa&codevProjectKind=git&codevCursorAvailable=1'
      } as Location)
    ).toEqual({
      projectPath: '/srv/codev/workspaces/c1f9fe13-6881-44a6-adbd-96bc5a946afa',
      projectKind: 'git',
      cursorAvailable: true
    })
  })

  it.each([
    '#codev=1&codevProject=%2Fsrv%2Fcodev%2Fpersonal%2Fc1f9fe13-6881-44a6-adbd-96bc5a946afa&codevProjectKind=folder&codevSettingsOnly=1',
    '#codev=1&codevProject=%2Fsrv%2Fcodev%2Fworkspaces%2F..%2Fsecret&codevProjectKind=folder&codevSettingsOnly=1',
    '#codev=1&codevProject=%2Fetc&codevProjectKind=git',
    '#codev=1&codevProject=%2Fsrv%2Fcodev%2Fworkspaces%2F..%2Fsecret&codevProjectKind=git',
    '#codev=1&codevProject=%2Fsrv%2Fcodev%2Fworkspaces%2Fc1f9fe13-6881-44a6-adbd-96bc5a946afa&codevProjectKind=other',
    '#codev=1&codevProject=%2Fsrv%2Fcodev%2Fworkspaces%2Fc1f9fe13-6881-44a6-adbd-96bc5a946afa&codevProjectKind=git&codevProjectName=..%2F..%2Fsecret',
    '#codevProject=%2Fsrv%2Fcodev%2Fworkspaces%2Fc1f9fe13-6881-44a6-adbd-96bc5a946afa&codevProjectKind=git'
  ])('rejects an untrusted bootstrap fragment: %s', (hash) => {
    expect(readCodevBootstrap({ hash } as Location)).toBeNull()
  })
})
