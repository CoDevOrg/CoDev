import { describe, expect, it } from 'vitest'
import {
  resolveOuterWrapperForegroundProcess,
  shouldInspectOuterWrapperForegroundProcess
} from './foreground-wrapper-agent'

describe('foreground wrapper agent resolution', () => {
  const codex = { agent: 'codex' as const, processName: 'codex' }
  const claude = { agent: 'claude' as const, processName: 'claude' }

  it('does not inspect ancestors for agents without a title identity group', () => {
    expect(shouldInspectOuterWrapperForegroundProcess(codex)).toBe(false)
    expect(shouldInspectOuterWrapperForegroundProcess(claude)).toBe(false)
  })

  it('leaves an agent without a title identity group untouched under a deeper same-name child', () => {
    expect(
      resolveOuterWrapperForegroundProcess(
        codex,
        { pid: 102, ppid: 101, command: 'node /usr/bin/codex' },
        [
          { pid: 102, ppid: 101, command: 'node /usr/bin/codex' },
          { pid: 101, ppid: 100, command: 'bash -l' }
        ]
      )
    ).toBe('codex')
  })
})
