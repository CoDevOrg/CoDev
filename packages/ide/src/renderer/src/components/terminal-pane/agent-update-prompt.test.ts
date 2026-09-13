import { describe, expect, it } from 'vitest'
import {
  detectAgentUpdatePrompt,
  hasClaudeUpdatePrompt,
  hasCodexUpdatePrompt
} from './agent-update-prompt'

describe('agent update prompts', () => {
  it('recognizes the Codex update prompt', () => {
    expect(
      detectAgentUpdatePrompt(
        'Update available! 0.131.0 -> 0.132.0\n1. Update now\n2. Skip\nPress enter to continue'
      )
    ).toEqual({ provider: 'codex', input: '1\r', skipInput: '2\r' })
    expect(hasCodexUpdatePrompt('Codex update available. See the release notes.')).toBe(false)
  })

  it('recognizes Codex command text even when the menu is redrawn', () => {
    expect(
      hasCodexUpdatePrompt(
        'Update available — runs npm install -g @openai/codex\n2. Skip\nPress enter to continue'
      )
    ).toBe(true)
  })

  it('recognizes Claude Code numbered update prompts', () => {
    expect(
      detectAgentUpdatePrompt('Claude Code update available\n1. Install update\n2. Skip for now')
    ).toEqual({ provider: 'claude', input: '1\r', skipInput: '2\r' })
    expect(hasClaudeUpdatePrompt('Update available 1. Install update 2. Skip until next')).toBe(
      true
    )
  })

  it('recognizes Claude Code yes/no update prompts', () => {
    expect(detectAgentUpdatePrompt('Claude Code: Install update? (y/n)', 'claude')).toEqual({
      provider: 'claude',
      input: 'y\r',
      skipInput: 'n\r'
    })
  })

  it('does not classify ordinary update text as actionable', () => {
    expect(detectAgentUpdatePrompt('Codex update available. See the release notes.')).toBe(null)
  })
})
