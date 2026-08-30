import { describe, expect, it } from 'vitest'
import { codexTerminalScreenToMessages } from './codex-terminal-transcript'

describe('codexTerminalScreenToMessages', () => {
  it('extracts user prompts and completed Codex replies', () => {
    const messages = codexTerminalScreenToMessages(`
› /model gpt-5.6-luna
• Model changed to gpt-5.6-luna high
› hi
• Hi! What would you like to work on?
› Ask Codex to do anything
gpt-5.6-luna high
`)

    expect(messages.map((message) => [message.role, message.blocks[0]])).toEqual([
      ['user', { type: 'text', text: 'hi' }],
      ['assistant', { type: 'text', text: 'Hi! What would you like to work on?' }]
    ])
  })

  it('does not turn model notices into assistant chat', () => {
    expect(
      codexTerminalScreenToMessages('› /model gpt-5.6-luna\n• Model changed to gpt-5.6-luna high')
    ).toEqual([])
  })
})
