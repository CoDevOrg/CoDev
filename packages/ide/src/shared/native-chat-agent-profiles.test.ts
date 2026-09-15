import { describe, expect, it } from 'vitest'
import { getNativeChatAgentProfile } from './native-chat-agent-profiles'

describe('native chat agent picker profiles', () => {
  it('keeps Codex dollar skills separate from slash commands', () => {
    expect(getNativeChatAgentProfile('codex')).toMatchObject({
      skillPrefix: '$',
      groupedSlash: false,
      skillSourceOwner: 'codex'
    })
  })

  it('does not grant custom or unverified agents a skill grammar', () => {
    expect(getNativeChatAgentProfile('custom-agent')).toBeNull()
  })
})
