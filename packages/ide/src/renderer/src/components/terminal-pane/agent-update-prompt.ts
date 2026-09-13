import type { IBuffer } from '@xterm/xterm'

const UPDATE_BUFFER_LINES = 96

export type AgentUpdateProvider = 'codex' | 'claude'

export type AgentUpdatePrompt = {
  provider: AgentUpdateProvider
  /** Input for the provider's own update prompt, including its submit key. */
  input: string
  /** Input for dismissing the provider's update prompt, including its submit key. */
  skipInput: string
}

/** Read only the recent terminal screen/scrollback needed to classify startup prompts. */
export function readRecentTerminalBuffer(buffer: IBuffer | undefined): string {
  if (!buffer || typeof buffer.getLine !== 'function') {
    return ''
  }

  const start = Math.max(0, buffer.length - UPDATE_BUFFER_LINES)
  const lines: string[] = []
  for (let index = start; index < buffer.length; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) ?? '')
  }
  return lines.join('\n')
}

function claudeUpdateInputs(normalized: string): Pick<AgentUpdatePrompt, 'input' | 'skipInput'> {
  return /(?:\(\s*y\s*\/\s*n\s*\)|\[\s*y\s*\/\s*n\s*\]|\byes?\b)/.test(normalized)
    ? { input: 'y\r', skipInput: 'n\r' }
    : { input: '1\r', skipInput: '2\r' }
}

/** Detect an actionable update prompt emitted by a supported provider. */
export function detectAgentUpdatePrompt(
  text: string,
  preferredProvider?: AgentUpdateProvider
): AgentUpdatePrompt | null {
  const normalized = text.replace(/\s+/g, ' ').toLowerCase()
  const hasClaudeUpdateCopy =
    /(update available|install update)/.test(normalized) &&
    /(skip for now|skip until next|press enter to continue|\(\s*y\s*\/\s*n\s*\)|\[\s*y\s*\/\s*n\s*\])/.test(
      normalized
    )
  const isClaudePrompt =
    hasClaudeUpdateCopy && (preferredProvider === 'claude' || normalized.includes('claude code'))

  if (isClaudePrompt) {
    return { provider: 'claude', ...claudeUpdateInputs(normalized) }
  }

  const updateIndex = normalized.lastIndexOf('update available')
  const readyIndex = Math.max(
    normalized.lastIndexOf('>_ openai codex'),
    normalized.lastIndexOf('openai codex (v')
  )
  const isCodexPrompt =
    updateIndex > readyIndex &&
    (preferredProvider === 'codex' ||
      normalized.includes('openai codex') ||
      normalized.includes('1. update now') ||
      normalized.includes('npm install -g @openai/codex')) &&
    (normalized.includes('press enter to continue') || normalized.includes('2. skip'))

  return isCodexPrompt ? { provider: 'codex', input: '1\r', skipInput: '2\r' } : null
}

/** Backwards-compatible predicate for Codex-specific callers and tests. */
export function hasCodexUpdatePrompt(text: string): boolean {
  return detectAgentUpdatePrompt(text, 'codex')?.provider === 'codex'
}

/** Predicate used by Claude-specific callers and tests. */
export function hasClaudeUpdatePrompt(text: string): boolean {
  return detectAgentUpdatePrompt(text, 'claude')?.provider === 'claude'
}
