import { describe, expect, it } from 'vitest'
import { decodeCursorTranscriptLine } from './transcript-line-decoders'

describe('decodeCursorTranscriptLine', () => {
  it('unwraps the <timestamp>/<user_query> envelope on a user line', () => {
    const line = JSON.stringify({
      role: 'user',
      message: {
        content: [
          {
            type: 'text',
            text:
              '<timestamp>Saturday, Aug 29, 2026, 11:50 PM (UTC)</timestamp>\n' +
              '<user_query>\nRun the tests\n</user_query>'
          }
        ]
      }
    })
    expect(decodeCursorTranscriptLine(line, 'off-1')).toEqual({
      id: 'off-1',
      role: 'user',
      blocks: [{ type: 'text', text: 'Run the tests' }],
      timestamp: Date.parse('Saturday, Aug 29, 2026, 11:50 PM (UTC)'),
      source: 'transcript'
    })
  })

  it('keeps a bare user prompt when there is no envelope', () => {
    const line = JSON.stringify({
      role: 'user',
      message: { content: [{ type: 'text', text: 'hello there' }] }
    })
    expect(decodeCursorTranscriptLine(line, 'off-2')).toMatchObject({
      role: 'user',
      blocks: [{ type: 'text', text: 'hello there' }],
      timestamp: null
    })
  })

  it('decodes assistant text and a Shell tool_use, dropping [REDACTED] markers', () => {
    const line = JSON.stringify({
      role: 'assistant',
      message: {
        content: [
          { type: 'text', text: ' [REDACTED]' },
          {
            type: 'tool_use',
            name: 'Shell',
            input: { command: 'echo hi && git branch --show-current' }
          },
          { type: 'text', text: '`hi`\n\nCurrent branch: **main**\n\n[REDACTED]' }
        ]
      }
    })
    expect(decodeCursorTranscriptLine(line, 'off-3')).toEqual({
      id: 'off-3',
      role: 'assistant',
      blocks: [
        {
          type: 'tool-call',
          name: 'Shell',
          input: { command: 'echo hi && git branch --show-current' }
        },
        { type: 'text', text: '`hi`\n\nCurrent branch: **main**' }
      ],
      timestamp: null,
      source: 'transcript'
    })
  })

  it('skips a turn_ended lifecycle record', () => {
    expect(
      decodeCursorTranscriptLine(JSON.stringify({ type: 'turn_ended', status: 'success' }), 'off-4')
    ).toBeNull()
  })

  it('skips an assistant row that is only redaction noise', () => {
    const line = JSON.stringify({
      role: 'assistant',
      message: { content: [{ type: 'text', text: '[REDACTED]' }] }
    })
    expect(decodeCursorTranscriptLine(line, 'off-5')).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(decodeCursorTranscriptLine('{not json', 'off-6')).toBeNull()
  })
})
