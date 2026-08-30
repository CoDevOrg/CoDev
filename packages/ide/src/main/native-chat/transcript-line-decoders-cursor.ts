// Cursor Agent CLI transcript line → NativeChatMessage decoder.
//
// `cursor-agent` writes one JSONL file per session at
// `~/.cursor/projects/<encoded-cwd>/agent-transcripts/<id>/<id>.jsonl`. Unlike
// Claude/Codex it carries no per-line id or timestamp; the discriminator is a
// top-level `role`, and turn boundaries are separate `{"type":"turn_ended"}`
// records (handled by the lifecycle decoder, skipped here).
//
// Observed line shapes:
//   {"role":"user","message":{"content":[{"type":"text",
//     "text":"<timestamp>…</timestamp>\n<user_query>\n…\n</user_query>"}]}}
//   {"role":"assistant","message":{"content":[
//     {"type":"text","text":"…"},
//     {"type":"tool_use","name":"Shell","input":{"command":"…"}}]}}
//   {"type":"turn_ended","status":"success"}

import type { NativeChatBlock, NativeChatMessage } from '../../shared/native-chat-types'
import {
  asRecord,
  extractString,
  parseJsonObject,
  timestampMs
} from '../ai-vault/session-scanner-values'

/** Cursor wraps the user's prompt with an injected time header and query tags. */
const USER_QUERY_RE = /<user_query>\n?([\s\S]*?)\n?<\/user_query>/
const TIMESTAMP_TAG_RE = /<timestamp>([\s\S]*?)<\/timestamp>/

/** `cursor-agent --print` splices bare `[REDACTED]` markers where it withholds a
 *  reasoning trace. They are noise in the rendered bubble, not content. */
function stripCursorRedaction(text: string): string {
  return text
    .replace(/(^|\n)\s*\[REDACTED\]\s*(?=\n|$)/g, '$1')
    .replace(/\s*\[REDACTED\]\s*$/g, '')
    .replace(/^\s*\[REDACTED\]\s*/g, '')
    .trimEnd()
}

function unwrapUserPrompt(raw: string): { text: string; timestamp: number | null } {
  const timestampMatch = raw.match(TIMESTAMP_TAG_RE)
  const parsed = timestampMatch ? Date.parse(timestampMatch[1]!.trim()) : NaN
  const queryMatch = raw.match(USER_QUERY_RE)
  const body = (queryMatch ? queryMatch[1]! : raw).trim()
  return { text: body, timestamp: Number.isFinite(parsed) ? parsed : null }
}

function cursorContentBlocks(content: unknown): NativeChatBlock[] {
  if (typeof content === 'string') {
    const text = stripCursorRedaction(content)
    return text ? [{ type: 'text', text }] : []
  }
  if (!Array.isArray(content)) {
    return []
  }
  const blocks: NativeChatBlock[] = []
  for (const item of content) {
    const record = asRecord(item)
    if (!record) {
      continue
    }
    switch (record.type) {
      case 'text': {
        const text = stripCursorRedaction(extractString(record.text) ?? '')
        if (text) {
          blocks.push({ type: 'text', text })
        }
        break
      }
      case 'tool_use':
      case 'tool_call': {
        const name = extractString(record.name) ?? 'tool'
        blocks.push({ type: 'tool-call', name, input: record.input ?? record.args ?? null })
        break
      }
      case 'tool_result': {
        const output = extractString(record.content) ?? extractString(record.output) ?? ''
        blocks.push({
          type: 'tool-result',
          output,
          ...(record.is_error === true ? { isError: true } : {})
        })
        break
      }
      default:
        break
    }
  }
  return blocks
}

export function decodeCursorTranscriptLine(
  line: string,
  fallbackId: string
): NativeChatMessage | null {
  const record = parseJsonObject(line)
  if (!record) {
    return null
  }
  const role = record.role
  if (role !== 'user' && role !== 'assistant') {
    // `turn_ended` and any other non-message record is lifecycle, not content.
    return null
  }
  const message = asRecord(record.message)
  const rawBlocks = cursorContentBlocks(message?.content)

  if (role === 'user') {
    const rawText = rawBlocks.find((block) => block.type === 'text')
    const source = rawText && rawText.type === 'text' ? rawText.text : ''
    const { text, timestamp } = unwrapUserPrompt(source)
    if (!text) {
      return null
    }
    return {
      id: fallbackId,
      role: 'user',
      blocks: [{ type: 'text', text }],
      timestamp,
      source: 'transcript'
    }
  }

  if (rawBlocks.length === 0) {
    return null
  }
  return {
    id: fallbackId,
    role: 'assistant',
    blocks: rawBlocks,
    timestamp: parseTimestamp(record.timestamp),
    source: 'transcript'
  }
}

function parseTimestamp(value: unknown): number | null {
  const parsed = timestampMs(value)
  return Number.isFinite(parsed) ? parsed : null
}
