import { describe, expect, it } from 'vitest'
import {
  formatTurnDuration,
  nativeChatTurnDurations,
  nativeChatTurnTotals
} from './native-chat-durations'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'

function message(timestamp: number | null): NativeChatMessage {
  return {
    id: `m-${timestamp}`,
    role: 'assistant',
    blocks: [{ type: 'text', text: 'x' }],
    timestamp,
    source: 'transcript'
  }
}

describe('nativeChatTurnDurations', () => {
  it('measures each turn against the next one', () => {
    const t = 1_000_000
    expect(
      nativeChatTurnDurations(
        [message(t), message(t + 6_000), message(t + 20_000)],
        t + 25_000
      )
    ).toEqual([6_000, 14_000, 5_000])
  })

  it('measures the in-progress final turn against the clock', () => {
    const t = 1_000_000
    const [, last] = nativeChatTurnDurations([message(t), message(t + 1_000)], t + 9_000)
    expect(last).toBe(8_000)
  })

  it('reports nothing for a message with no timestamp', () => {
    const t = 1_000_000
    expect(nativeChatTurnDurations([message(null), message(t)], t)).toEqual([null, 0])
  })

  it('rejects a span from a paused session or a clock jump', () => {
    const t = 1_000_000
    expect(
      nativeChatTurnDurations([message(t), message(t + 4 * 60 * 60_000)], t)
    ).toEqual([null, null])
  })

  it('rejects a negative span from out-of-order timestamps', () => {
    const t = 1_000_000
    expect(nativeChatTurnDurations([message(t), message(t - 5_000)], t)[0]).toBeNull()
  })
})

describe('formatTurnDuration', () => {
  it('stays quiet about sub-second steps', () => {
    expect(formatTurnDuration(null)).toBeNull()
    expect(formatTurnDuration(300)).toBeNull()
  })

  it('reads as seconds, then minutes and seconds', () => {
    expect(formatTurnDuration(6_400)).toBe('6s')
    expect(formatTurnDuration(64_000)).toBe('1m 04s')
    expect(formatTurnDuration(600_000)).toBe('10m 00s')
  })
})

describe('nativeChatTurnTotals', () => {
  function turn(role: NativeChatMessage['role'], timestamp: number | null): NativeChatMessage {
    return {
      id: `${role}-${timestamp}`,
      role,
      blocks: [{ type: 'text', text: 'x' }],
      timestamp,
      source: 'transcript'
    }
  }

  it('measures a finished turn from the prompt to its last message', () => {
    const t = 1_000_000
    const totals = nativeChatTurnTotals(
      [turn('user', t), turn('assistant', t + 3_000), turn('assistant', t + 11_000)],
      t + 90_000,
      false
    )
    expect(totals).toEqual([null, null, 11_000])
  })

  it('survives a response split into tool and prose sharing one timestamp', () => {
    // The real failure: both assistant messages carry the same transcript
    // timestamp, so per-message spans are 0 and report nothing.
    const t = 1_000_000
    const totals = nativeChatTurnTotals(
      [turn('user', t), turn('assistant', t + 9_000), turn('assistant', t + 9_000)],
      t + 20_000,
      false
    )
    expect(totals[2]).toBe(9_000)
  })

  it('ticks the in-flight turn against the clock', () => {
    const t = 1_000_000
    const totals = nativeChatTurnTotals(
      [turn('user', t), turn('assistant', t + 2_000)],
      t + 7_500,
      true
    )
    expect(totals[1]).toBe(7_500)
  })

  it('closes each turn on its own last message', () => {
    const t = 1_000_000
    const totals = nativeChatTurnTotals(
      [
        turn('user', t),
        turn('assistant', t + 5_000),
        turn('user', t + 30_000),
        turn('assistant', t + 34_000)
      ],
      t + 40_000,
      false
    )
    expect(totals).toEqual([null, 5_000, null, 4_000])
  })

  it('reports nothing when the prompt has no timestamp', () => {
    const t = 1_000_000
    expect(nativeChatTurnTotals([turn('user', null), turn('assistant', t)], t, false)).toEqual([
      null,
      null
    ])
  })
})
