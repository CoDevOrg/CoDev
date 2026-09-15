import { describe, expect, it } from 'vitest'
import { isRemoteRuntimePastePtyId, resolveTerminalPasteRuntime } from './terminal-paste-runtime'

describe('terminal paste runtime', () => {
  it('uses the platform-local runtime when no SSH identity is available', () => {
    expect(
      resolveTerminalPasteRuntime({
        platform: 'win32',
        ptyId: 'pty-1',
        connectionId: null
      })
    ).toEqual({
      platform: 'win32',
      runtimeKey: 'local:win32',
      kind: 'local'
    })
  })

  it('ignores remote platform metadata for captured local sessions', () => {
    expect(
      resolveTerminalPasteRuntime({
        platform: 'darwin',
        ptyId: 'pty-1',
        connectionId: 'ssh-current',
        remotePlatform: 'win32',
        transport: {
}
      })
    ).toMatchObject({
      platform: 'darwin',
      runtimeKey: 'local:darwin',
      kind: 'local'
    })
  })

  it('keeps transport-captured local sessions local when the worktree later becomes SSH', () => {
    expect(
      resolveTerminalPasteRuntime({
        platform: 'darwin',
        ptyId: 'pty-1',
        connectionId: 'ssh-current',
        transport: { }
      })
    ).toMatchObject({
      platform: 'darwin',
      runtimeKey: 'local:darwin',
      kind: 'local'
    })
  })

  it('classifies local WSL UNC sessions by their captured distro', () => {
    expect(
      resolveTerminalPasteRuntime({
        platform: 'win32',
        ptyId: 'pty-1',
        connectionId: null,
        transport: {
          getLocalSessionMetadata: () => ({
            cwd: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\user\\repo'
          })
        },
        isWindowsConpty: false
      })
    ).toEqual({
      platform: 'win32',
      runtimeKey: 'wsl:Ubuntu-24.04',
      kind: 'wsl',
      isWindowsConpty: false
    })
  })

  it('classifies local WSL shell override sessions without relying on current settings', () => {
    expect(
      resolveTerminalPasteRuntime({
        platform: 'win32',
        ptyId: 'pty-1',
        connectionId: null,
        transport: {
          getLocalSessionMetadata: () => ({ shellOverride: 'C:\\Windows\\System32\\wsl.exe' })
        }
      })
    ).toMatchObject({
      platform: 'win32',
      runtimeKey: 'wsl:default',
      kind: 'wsl'
    })
  })

  it('classifies quoted WSL shell overrides that include arguments', () => {
    expect(
      resolveTerminalPasteRuntime({
        platform: 'win32',
        ptyId: 'pty-1',
        connectionId: null,
        transport: {
          getLocalSessionMetadata: () => ({
            shellOverride: '  "C:\\Windows\\System32\\wsl.exe" -d Ubuntu-24.04'
          })
        }
      })
    ).toMatchObject({
      runtimeKey: 'wsl:default',
      kind: 'wsl'
    })
  })

  it('does not classify non-WSL shell overrides that merely contain wsl in arguments', () => {
    expect(
      resolveTerminalPasteRuntime({
        platform: 'win32',
        ptyId: 'pty-1',
        connectionId: null,
        transport: {
          getLocalSessionMetadata: () => ({
            shellOverride: 'powershell.exe -NoProfile wsl.exe'
          })
        }
      })
    ).toMatchObject({
      runtimeKey: 'local:win32',
      kind: 'local'
    })
  })

  it('treats remote runtime PTY ids as remote even when an SSH identity is present', () => {
    expect(
      resolveTerminalPasteRuntime({
        platform: 'linux',
        ptyId: 'remote:terminal-1',
        connectionId: 'ssh-current',
        transport: { },
        isWindowsConpty: true
      })
    ).toEqual({
      platform: 'linux',
      runtimeKey: 'remote:remote:terminal-1',
      kind: 'remote-runtime',
      isWindowsConpty: true
    })
  })

  it('keeps remote runtime PTY precedence over local WSL metadata', () => {
    expect(
      resolveTerminalPasteRuntime({
        platform: 'win32',
        ptyId: 'remote:env-1@@terminal-1',
        connectionId: null,
        transport: {
          getLocalSessionMetadata: () => ({
            cwd: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\user\\repo'
          })
        }
      })
    ).toMatchObject({
      runtimeKey: 'remote:remote:env-1@@terminal-1',
      kind: 'remote-runtime'
    })
  })

  it('recognizes remote runtime PTY ids', () => {
    expect(isRemoteRuntimePastePtyId('remote:terminal-1')).toBe(true)
    expect(isRemoteRuntimePastePtyId('pty-1')).toBe(false)
    expect(isRemoteRuntimePastePtyId(null)).toBe(false)
  })
})
