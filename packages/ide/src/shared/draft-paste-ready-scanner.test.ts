import { describe, expect, it } from 'vitest'
import { createDraftPasteReadyScanner } from './draft-paste-ready-scanner'

const DECSET_BRACKETED_PASTE = '\x1b[?2004h'
const SHOW_CURSOR = '\x1b[?25h'
const CODEX_PROMPT = '\x1b[1m›\x1b[0m Ask Codex to do anything'

describe('createDraftPasteReadyScanner', () => {
  describe('codex-composer-prompt (unchanged behavior)', () => {
    it('is ready on the composer glyph after bracketed paste and never arms the quiet timer', () => {
      const scanner = createDraftPasteReadyScanner('codex-composer-prompt')
      expect(scanner.observe(DECSET_BRACKETED_PASTE)).toEqual({
        ready: false,
        armQuietTimer: false
      })
      expect(scanner.observe(CODEX_PROMPT)).toEqual({ ready: true, armQuietTimer: false })
    })

    it('detects the composer glyph inside a large first render chunk', () => {
      const scanner = createDraftPasteReadyScanner('codex-composer-prompt')
      expect(scanner.observe(`${DECSET_BRACKETED_PASTE}${CODEX_PROMPT}${'x'.repeat(900)}`)).toEqual(
        { ready: true, armQuietTimer: false }
      )
    })

    it('never arms the quiet-window fallback', () => {
      const scanner = createDraftPasteReadyScanner('codex-composer-prompt')
      expect(scanner.observe(DECSET_BRACKETED_PASTE)).toEqual({
        ready: false,
        armQuietTimer: false
      })
      expect(scanner.observe('noise')).toEqual({ ready: false, armQuietTimer: false })
    })
  })

  describe('render-quiet-after-bracketed-paste (default)', () => {
    it('arms the quiet timer after bracketed paste and never reports a signal', () => {
      const scanner = createDraftPasteReadyScanner('render-quiet-after-bracketed-paste')
      expect(scanner.observe(DECSET_BRACKETED_PASTE)).toEqual({ ready: false, armQuietTimer: true })
      // Show-cursor is not a signal for the default path; it just keeps arming.
      expect(scanner.observe(SHOW_CURSOR)).toEqual({ ready: false, armQuietTimer: true })
    })

    it('does nothing until bracketed paste is enabled', () => {
      const scanner = createDraftPasteReadyScanner('render-quiet-after-bracketed-paste')
      expect(scanner.observe('pre-handshake output')).toEqual({
        ready: false,
        armQuietTimer: false
      })
    })
  })
})
