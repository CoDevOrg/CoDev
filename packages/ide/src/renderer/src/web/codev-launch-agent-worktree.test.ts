import { describe, expect, it } from 'vitest'
import {
  deriveAgentWorktreeIdentity,
  isCodevAgentWorktree
} from './codev-launch-agent-worktree'

describe('deriveAgentWorktreeIdentity', () => {
  it('produces a codev/<agent>-<hex> branch and a matching name half', () => {
    const { branchName, name } = deriveAgentWorktreeIdentity('claude')
    expect(branchName).toMatch(/^codev\/claude-[0-9a-f]{8}$/)
    expect(branchName).toBe(`codev/${name}`)
  })

  it('slugs an odd agent id and never yields an empty slug', () => {
    expect(deriveAgentWorktreeIdentity('Command Code' as never).branchName).toMatch(
      /^codev\/command-code-[0-9a-f]{8}$/
    )
    expect(deriveAgentWorktreeIdentity('***' as never).branchName).toMatch(
      /^codev\/agent-[0-9a-f]{8}$/
    )
  })

  it('is unique per call', () => {
    expect(deriveAgentWorktreeIdentity('codex').branchName).not.toBe(
      deriveAgentWorktreeIdentity('codex').branchName
    )
  })
})

describe('isCodevAgentWorktree', () => {
  it('never counts the main working tree', () => {
    expect(
      isCodevAgentWorktree({ isMainWorktree: true, branch: 'codev/claude-1', createdWithAgent: 'claude' })
    ).toBe(false)
  })

  it('counts a codev/* branch or an agent-stamped worktree', () => {
    expect(isCodevAgentWorktree({ branch: 'codev/codex-abcdef12' })).toBe(true)
    expect(isCodevAgentWorktree({ branch: 'feature/x', createdWithAgent: 'claude' })).toBe(true)
  })

  it('ignores an ordinary linked worktree', () => {
    expect(isCodevAgentWorktree({ branch: 'feature/x' })).toBe(false)
    expect(isCodevAgentWorktree({})).toBe(false)
  })
})
