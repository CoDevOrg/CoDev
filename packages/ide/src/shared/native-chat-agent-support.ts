export type NativeChatTranscriptAgent = 'claude' | 'codex'

/** Agents whose transcripts the native chat view can parse and render. */
export const NATIVE_CHAT_SUPPORTED_AGENTS: ReadonlySet<string> = new Set(['claude', 'codex'])

export function isNativeChatSupportedAgent(agent: string | null | undefined): boolean {
  return agent != null && NATIVE_CHAT_SUPPORTED_AGENTS.has(agent)
}

/** True when the agent renders a digit-commit question selector that ignores
 *  typed label text (pasting "Blue" + Enter commits the highlighted FIRST
 *  option — STA-1860): Claude's AskUserQuestion and Codex 0.145's
 *  request_user_input card both behave this way, so answers must be delivered
 *  as per-option keystrokes. Other agents commit a pasted answer. */
export function shouldStepNativeChatAskAnswer(agent: string | null | undefined): boolean {
  const transcriptAgent = resolveNativeChatTranscriptAgent(agent)
  return transcriptAgent === 'claude' || transcriptAgent === 'codex'
}

export function resolveNativeChatTranscriptAgent(
  agent: string | null | undefined
): NativeChatTranscriptAgent | null {
  if (agent === 'claude' || agent === 'codex') {
    return agent
  }
  return null
}
