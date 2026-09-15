import { describe, expect, it } from 'vitest'

import { } from '../../../shared/stable-pane-id'
import {
  resolveAgentStatusConnectionRouting,
} from './agent-status-connection-ownership'

describe('agent status connection ownership', () => {

  it('marks known local, WSL, and remote-runtime PTYs as non-SSH', () => {
    expect(
      resolveAgentStatusConnectionRouting({ ptyId: 'pty-local-1', expectedConnectionId: null })
    ).toEqual({ connectionId: null })
    expect(
      resolveAgentStatusConnectionRouting({ ptyId: 'pty-wsl-1', expectedConnectionId: null })
    ).toEqual({ connectionId: null })
    expect(
      resolveAgentStatusConnectionRouting({
        ptyId: 'remote:env-a@@terminal-1',
        expectedConnectionId: null,
        runtimeEnvironmentId: 'env-a'
      })
    ).toEqual({ connectionId: null })
  })

  it('fails closed for missing, malformed, and cross-runtime ownership', () => {
    expect(resolveAgentStatusConnectionRouting({ ptyId: null })).toBeUndefined()
    expect(resolveAgentStatusConnectionRouting({ ptyId: 'remote:' })).toBeUndefined()
    expect(
      resolveAgentStatusConnectionRouting({
        ptyId: 'remote:env-a@@terminal-1',
        expectedConnectionId: 'ssh-a',
        runtimeEnvironmentId: 'env-a'
      })
    ).toBeUndefined()
    expect(
      resolveAgentStatusConnectionRouting({
        ptyId: 'remote:env-a@@terminal-1',
        expectedConnectionId: null,
        runtimeEnvironmentId: 'env-b'
      })
    ).toBeUndefined()
  })

})
