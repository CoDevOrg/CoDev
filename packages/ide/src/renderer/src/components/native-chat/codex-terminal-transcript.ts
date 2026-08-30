import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import { stripScrollbackAnsi } from './native-chat-scrape-fallback'

const CODEX_PROMPT = /^\s*›\s+(.*)$/
const CODEX_REPLY = /^\s*•\s+(.*)$/

function isComposerPlaceholder(value: string): boolean {
  return /^(?:Ask Codex to|Type a message|Describe a task)/i.test(value)
}

/**
 * Best-effort fallback for Codex's alternate-screen TUI when the structured
 * transcript hook is unavailable. Only explicit Codex prompt/reply markers are
 * accepted; status lines, model notices, and the composer placeholder are
 * intentionally ignored.
 */
export function codexTerminalScreenToMessages(screen: string | null): NativeChatMessage[] {
  if (!screen) return []

  const messages: NativeChatMessage[] = []
  let activeRole: 'user' | 'assistant' | null = null
  let activeLines: string[] = []

  const flush = (): void => {
    const text = activeLines.join('\n').trim()
    if (activeRole && text) {
      messages.push({
        id: `codex-screen-${messages.length}-${activeRole}-${text}`,
        role: activeRole,
        blocks: [{ type: 'text', text }],
        timestamp: null,
        source: 'scrape'
      })
    }
    activeRole = null
    activeLines = []
  }

  for (const line of stripScrollbackAnsi(screen).split('\n')) {
    const prompt = line.match(CODEX_PROMPT)?.[1]?.trim()
    if (prompt !== undefined) {
      flush()
      if (prompt && !prompt.startsWith('/') && !isComposerPlaceholder(prompt)) {
        activeRole = 'user'
        activeLines = [prompt]
      }
      continue
    }

    const reply = line.match(CODEX_REPLY)?.[1]?.trim()
    if (reply !== undefined) {
      flush()
      // Codex uses bullets for both assistant prose and local model/status
      // notices. A reply is only conversational when it follows a user prompt.
      if (messages.at(-1)?.role === 'user') {
        activeRole = 'assistant'
        activeLines = [reply]
      }
      continue
    }

    if (activeRole && line.trim()) {
      activeLines.push(line.trim())
    }
  }
  flush()
  return messages
}
