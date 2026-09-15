import { describe, expect, it } from 'vitest'
import {
  shouldStepNativeChatAskAnswer
} from './native-chat-agent-support'

describe('resolveNativeChatTranscriptAgent', () => {

})

describe('isNativeChatSupportedAgent', () => {
})

describe('shouldStepNativeChatAskAnswer', () => {

  it('does not step other or unknown agents', () => {
    expect(shouldStepNativeChatAskAnswer('grok')).toBe(false)
    expect(shouldStepNativeChatAskAnswer('cursor')).toBe(false)
    expect(shouldStepNativeChatAskAnswer(null)).toBe(false)
    expect(shouldStepNativeChatAskAnswer(undefined)).toBe(false)
  })
})
