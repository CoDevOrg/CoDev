/* eslint-disable max-lines -- Why: canonical transport-agnostic listener; parser, normalizer, per-CLI extractors, and endpoint writer share invariants that must not drift between Orca's main process and the relay. */

// Why: extracted from src/main/agent-hooks/server.ts so the relay can host the pipeline without Electron (Node builtins only). See docs/design/agent-status-over-ssh.md §3.
import type { IncomingMessage } from 'node:http'
import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

import {
  AGENT_MODEL_MAX_LENGTH,
  normalizeAgentStatusPayload,
  type AgentStatusState,
  type AgentSubagentSnapshot,
  type ParsedAgentStatusPayload
} from './agent-status-types'
import { normalizeOptionalField } from './agent-status-field-normalization'
import { isAskUserQuestionTool } from './agent-question-answered-intent'
import {
  claudeRosterHasWorkingSubagent,
  claudeRosterToSnapshots,
  claudeTeammateIdMatchesName,
  foldClaudeBackgroundTasksIntoRoster,
  idleClaudeTeammateByName,
  reapRestoredClaudeSubagentsWithoutLiveAgent,
  stopClaudeSubagent,
  upsertWorkingClaudeSubagent,
  type ClaudeSubagentRoster
} from './claude-subagent-roster'
import { readClaudeBackgroundAgentTasks } from './claude-background-task-inventory'
import {
  codexRosterEffectiveState,
  codexRosterToSnapshots,
  finishCodexSubagent,
  seedCodexSubagentRoster,
  upsertCodexSubagent,
  type CodexSubagentRoster
} from './codex-subagent-roster'
import {
  createCodexSubagentTranscriptState,
  hasTrackedCodexTranscriptSubagents,
  reconcileCodexSubagentTranscript,
  type CodexSubagentTranscriptState
} from './codex-subagent-transcript'
import { ORCA_HOOK_PROTOCOL_VERSION } from './agent-hook-types'
import { REMOTE_AGENT_HOOK_ENV, type AgentHookSource } from './agent-hook-relay'
import {
  agentProviderSessionsEqual,
  extractAgentProviderSession,
  type AgentProviderSessionMetadata
} from './agent-session-resume'
import { parsePaneKey } from './stable-pane-id'
import {
  isCompactContinuationUserTurnText,
  isKnownHarnessInjectedUserTurnText
} from './harness-injected-user-turns'
import { sweepStaleAgentHookEndpointTemps } from './agent-hook-endpoint-temp-cleanup'
import { assertJsonTextStructureWithinLimits } from './json-text-structure-limit'

/** Maximum request body size accepted by the listener (1 MB). */
export const HOOK_REQUEST_MAX_BYTES = 1_000_000
const HOOK_REQUEST_INITIAL_BUFFER_BYTES = 4 * 1024
const AGENT_HOOK_JSON_STRUCTURE_LIMITS = {
  structuralTokens: 128 * 1024,
  nestingDepth: 64
} as const

function parseAgentHookJson(content: string): unknown {
  assertJsonTextStructureWithinLimits(content, AGENT_HOOK_JSON_STRUCTURE_LIMITS)
  return JSON.parse(content) as unknown
}

/** Bound the warn-once Sets so a client varying `version`/`env` per request can't grow them unbounded. */
const MAX_WARNED_KEYS = 32

/** Slowloris cap: drop requests that have not finished sending after 5 s. */
export const HOOK_REQUEST_SLOWLORIS_MS = 5_000


/** Bound paneKey size (real keys are well under 200); caps per-pane caches against pathological input. Exported so non-HTTP ingest (`ingestRemote`) applies the same cap as defense-in-depth. */
export const MAX_PANE_KEY_LEN = 200
const CLAUDE_PROMPT_ID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export function normalizeClaudePromptId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const normalized = value.trim().toLowerCase()
  return CLAUDE_PROMPT_ID_RE.test(normalized) ? normalized : undefined
}

/** Per-listener-instance caches needing per-PTY teardown; Orca's main process and the relay each get their own, never shared. */
export type HookListenerState = {
  warnedVersions: Set<string>
  warnedEnvs: Set<string>
  lastPromptByPaneKey: Map<string, string>
  lastToolByPaneKey: Map<string, ToolSnapshot>
  lastStatusByPaneKey: Map<string, AgentHookEventPayload>
  /** Live subagents/teammates per Claude pane; survives turn boundaries since background children outlive the lead turn. */
  claudeSubagentRosterByPaneKey: Map<string, ClaudeSubagentRoster>
  /** Last state from the LEAD session's own events (subagent events carry agent_id, excluded), so a SubagentStop can re-emit pane status; `interrupted` persists so the eventual done still carries it. */
  claudeLeadStateByPaneKey: Map<string, ClaudeLeadTurnState>
  /** Panes whose latest authoritative Claude task inventory still has running non-agent work. */
  claudeRunningNonAgentTaskPaneKeys: Set<string>
  /** Panes whose latest authoritative Claude cron inventory still has a scheduled job. */
  claudeActiveSessionCronPaneKeys: Set<string>
  /** Live thread-spawn children per Codex pane. */
  codexSubagentRosterByPaneKey: Map<string, CodexSubagentRoster>
  /** Incremental parent/child rollout cursors for Codex collaboration v2. */
  codexSubagentTranscriptByPaneKey: Map<string, CodexSubagentTranscriptState>
  /** Root Codex state/model, kept separate from child hook traffic. */
  codexLeadStateByPaneKey: Map<string, CodexLeadTurnState>
}

export type ClaudeLeadTurnState = {
  state: AgentStatusState
  interrupted?: true
  /** Subagent that induced the wait; only its next tool activity may clear it, so other children's churn can't dismiss a pending human-input card. */
  waitingAgentId?: string
  /** Lead state a child-induced wait displaced, restored when the wait clears; can't invent 'working' since the done-gate only downgrades done→working, never back. */
  stateBeforeWait?: Pick<ClaudeLeadTurnState, 'state' | 'interrupted'>
}

type CodexLeadTurnState = {
  state: 'working' | 'waiting' | 'done'
  model?: string
}

export function createHookListenerState(): HookListenerState {
  return {
    warnedVersions: new Set(),
    warnedEnvs: new Set(),
    lastPromptByPaneKey: new Map(),
    lastToolByPaneKey: new Map(),
    lastStatusByPaneKey: new Map(),
    claudeSubagentRosterByPaneKey: new Map(),
    claudeLeadStateByPaneKey: new Map(),
    claudeRunningNonAgentTaskPaneKeys: new Set(),
    claudeActiveSessionCronPaneKeys: new Set(),
    codexSubagentRosterByPaneKey: new Map(),
    codexSubagentTranscriptByPaneKey: new Map(),
    codexLeadStateByPaneKey: new Map()
  }
}

export function clearPaneCacheState(state: HookListenerState, paneKey: string): void {
  deletePaneScopedCacheEntry(state.lastPromptByPaneKey, paneKey)
  deletePaneScopedCacheEntry(state.lastToolByPaneKey, paneKey)
  deletePaneScopedCacheEntry(state.lastStatusByPaneKey, paneKey)
  state.claudeSubagentRosterByPaneKey.delete(paneKey)
  state.claudeLeadStateByPaneKey.delete(paneKey)
  state.claudeRunningNonAgentTaskPaneKeys.delete(paneKey)
  state.claudeActiveSessionCronPaneKeys.delete(paneKey)
  state.codexSubagentRosterByPaneKey.delete(paneKey)
  state.codexSubagentTranscriptByPaneKey.delete(paneKey)
  state.codexLeadStateByPaneKey.delete(paneKey)
}

function movePaneScopedMapEntries<T>(
  map: Map<string, T>,
  fromPaneKey: string,
  toPaneKey: string
): void {
  for (const [key, value] of Array.from(map.entries())) {
    if (key !== fromPaneKey && !key.startsWith(`${fromPaneKey}\0`)) {
      continue
    }
    map.delete(key)
    map.set(`${toPaneKey}${key.slice(fromPaneKey.length)}`, value)
  }
}

function movePaneScopedSetEntries(set: Set<string>, fromPaneKey: string, toPaneKey: string): void {
  for (const key of Array.from(set)) {
    if (key !== fromPaneKey && !key.startsWith(`${fromPaneKey}\0`)) {
      continue
    }
    set.delete(key)
    set.add(`${toPaneKey}${key.slice(fromPaneKey.length)}`)
  }
}

export function movePaneCacheState(
  state: HookListenerState,
  fromPaneKey: string,
  toPaneKey: string
): void {
  if (fromPaneKey === toPaneKey) {
    return
  }
  movePaneScopedMapEntries(state.lastPromptByPaneKey, fromPaneKey, toPaneKey)
  movePaneScopedMapEntries(state.lastToolByPaneKey, fromPaneKey, toPaneKey)
  movePaneScopedMapEntries(state.lastStatusByPaneKey, fromPaneKey, toPaneKey)
  movePaneScopedMapEntries(state.claudeSubagentRosterByPaneKey, fromPaneKey, toPaneKey)
  movePaneScopedMapEntries(state.claudeLeadStateByPaneKey, fromPaneKey, toPaneKey)
  movePaneScopedSetEntries(state.claudeRunningNonAgentTaskPaneKeys, fromPaneKey, toPaneKey)
  movePaneScopedSetEntries(state.claudeActiveSessionCronPaneKeys, fromPaneKey, toPaneKey)
  movePaneScopedMapEntries(state.codexSubagentRosterByPaneKey, fromPaneKey, toPaneKey)
  movePaneScopedMapEntries(state.codexSubagentTranscriptByPaneKey, fromPaneKey, toPaneKey)
  movePaneScopedMapEntries(state.codexLeadStateByPaneKey, fromPaneKey, toPaneKey)
}

function deletePaneScopedCacheEntry(map: Map<string, unknown>, paneKey: string): void {
  map.delete(paneKey)
  const scopedPrefix = `${paneKey}\0`
  for (const key of map.keys()) {
    if (key.startsWith(scopedPrefix)) {
      map.delete(key)
    }
  }
}

export function clearAllListenerCaches(state: HookListenerState): void {
  state.lastPromptByPaneKey.clear()
  state.lastToolByPaneKey.clear()
  state.lastStatusByPaneKey.clear()
  state.warnedVersions.clear()
  state.warnedEnvs.clear()
  state.claudeSubagentRosterByPaneKey.clear()
  state.claudeLeadStateByPaneKey.clear()
  state.claudeRunningNonAgentTaskPaneKeys.clear()
  state.claudeActiveSessionCronPaneKeys.clear()
  state.codexSubagentRosterByPaneKey.clear()
  state.codexSubagentTranscriptByPaneKey.clear()
  state.codexLeadStateByPaneKey.clear()
}

/** Warn-once on cross-build (`version`) and dev-vs-prod (`env`) mismatches; the relay's "remote" env marker is a location tag, not a build env, so it must not warn as a stale local hook. */
export function warnOnHookEnvOrVersionMismatch(
  state: HookListenerState,
  fields: { version?: string; env?: string; expectedEnv: string }
): void {
  const { version, env, expectedEnv } = fields
  if (
    version &&
    version !== ORCA_HOOK_PROTOCOL_VERSION &&
    !state.warnedVersions.has(version) &&
    state.warnedVersions.size < MAX_WARNED_KEYS
  ) {
    state.warnedVersions.add(version)
    console.warn(
      `[agent-hooks] received hook v${version}; server expects v${ORCA_HOOK_PROTOCOL_VERSION}. ` +
        'Reinstall agent hooks from Settings to upgrade the managed script.'
    )
  }
  if (env && env !== REMOTE_AGENT_HOOK_ENV && env !== expectedEnv) {
    const key = `${env}->${expectedEnv}`
    if (!state.warnedEnvs.has(key) && state.warnedEnvs.size < MAX_WARNED_KEYS) {
      state.warnedEnvs.add(key)
      console.warn(
        `[agent-hooks] received ${env} hook on ${expectedEnv} server. ` +
          'Likely a stale terminal from another Orca install.'
      )
    }
  }
}

export type AgentHookEventPayload = {
  paneKey: string
  /** Authenticated hook route that produced this event. */
  source?: AgentHookSource
  /** Ephemeral Orca launch identity stamped into the PTY env for this process. */
  launchToken?: string
  tabId?: string
  worktreeId?: string
  /** SSH connection the event arrived on, or null for local (only ingestRemote stamps it; the HTTP path can't know the mux). See docs/design/agent-status-over-ssh.md §5. */
  connectionId: string | null
  /** True when the event carried prompt text directly, not the listener's cached prompt from an earlier event in the pane. */
  hasExplicitPrompt?: boolean
  /** Stable per-turn key to distinguish duplicate hook delivery from a same-text prompt rerun (when the source exposes enough context). */
  promptInteractionKey?: string
  /** Raw agent hook event name, used by main-process transition guards. */
  hookEventName?: string
  /** Claude's provider-owned user-prompt UUID. */
  providerPromptId?: string
  /** Active Claude compact generation, keyed by provider prompt identity. */
  compactTrigger?: 'manual' | 'auto'
  /** Claude tool-use identifier when the hook source exposes one. */
  toolUseId?: string
  /** Claude agent/subagent identifier when the hook source exposes one. */
  toolAgentId?: string
  /** Agent/subagent type from the source hook payload, when present. */
  toolAgentType?: string
  /** Provider-owned conversation/session id needed to resume a sleeping agent. */
  providerSession?: AgentProviderSessionMetadata
  /** Session identity update with no turn-state transition; refreshes durable resume metadata without a fake status row. */
  providerSessionOnly?: boolean
  /** True when this event is a relay cache replay rather than a live hook. */
  isReplay?: boolean
  /** Transport-only Claude background-work evidence used to reject false input-based interrupts. */
  claudeRunningNonAgentTask?: boolean
  payload: ParsedAgentStatusPayload
}

type ClaudeCompactIdentity = Pick<
  AgentHookEventPayload,
  | 'source'
  | 'connectionId'
  | 'hookEventName'
  | 'providerPromptId'
  | 'compactTrigger'
  | 'providerSession'
>

export function canAcceptClaudeCompactTransition(
  previous: AgentHookEventPayload | undefined,
  incoming: ClaudeCompactIdentity,
  options: { allowUnanchoredPreCompact?: boolean; allowUnanchoredPostCompact?: boolean } = {}
): boolean {
  if (
    incoming.source !== 'claude' ||
    incoming.compactTrigger === undefined ||
    incoming.providerPromptId === undefined ||
    (incoming.hookEventName !== 'PreCompact' && incoming.hookEventName !== 'PostCompact')
  ) {
    return false
  }
  if (incoming.hookEventName === 'PreCompact' && options.allowUnanchoredPreCompact) {
    return true
  }
  if (incoming.hookEventName === 'PostCompact' && options.allowUnanchoredPostCompact) {
    return true
  }
  if (
    previous?.source !== 'claude' ||
    previous.payload.agentType !== 'claude' ||
    previous.connectionId !== incoming.connectionId ||
    !agentProviderSessionsEqual('claude', previous.providerSession, incoming.providerSession)
  ) {
    return false
  }
  if (incoming.hookEventName === 'PostCompact') {
    return (
      previous.compactTrigger === incoming.compactTrigger &&
      previous.providerPromptId === incoming.providerPromptId
    )
  }
  return incoming.compactTrigger === 'manual'
    ? previous.providerPromptId !== undefined
    : previous.providerPromptId === incoming.providerPromptId
}

export function resolveCachedClaudeCompactOwnership(
  previous: AgentHookEventPayload | undefined,
  incoming: AgentHookEventPayload
): AgentHookEventPayload {
  const sameClaudeOwner =
    previous?.source === 'claude' &&
    previous.payload.agentType === 'claude' &&
    incoming.source === 'claude' &&
    incoming.payload.agentType === 'claude' &&
    incoming.connectionId === previous.connectionId &&
    agentProviderSessionsEqual('claude', previous.providerSession, incoming.providerSession)
      ? previous
      : undefined
  if (incoming.hookEventName === 'PreCompact' && incoming.compactTrigger) {
    return sameClaudeOwner?.payload.prompt && incoming.payload.prompt.length === 0
      ? { ...incoming, payload: { ...incoming.payload, prompt: sameClaudeOwner.payload.prompt } }
      : incoming
  }
  if (incoming.hookEventName === 'PostCompact') {
    return incoming.compactTrigger ? { ...incoming, compactTrigger: undefined } : incoming
  }
  const ownsCompact =
    sameClaudeOwner?.compactTrigger !== undefined &&
    sameClaudeOwner.providerPromptId !== undefined &&
    incoming.providerPromptId === sameClaudeOwner.providerPromptId
  if (ownsCompact) {
    return {
      ...incoming,
      compactTrigger: sameClaudeOwner.compactTrigger,
      payload:
        incoming.payload.prompt.length === 0 && sameClaudeOwner.payload.prompt
          ? { ...incoming.payload, prompt: sameClaudeOwner.payload.prompt }
          : incoming.payload
    }
  }
  return incoming.compactTrigger ? { ...incoming, compactTrigger: undefined } : incoming
}

// ─── Body parsing ───────────────────────────────────────────────────

export function parseFormEncodedBody(body: string): Record<string, string> {
  const params = new URLSearchParams(body)
  const parsed: Record<string, string> = {}
  for (const [key, value] of params.entries()) {
    parsed[key] = value
  }
  return parsed
}

export function readRequestBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let retained = Buffer.alloc(0)
    let byteLength = 0
    let settled = false
    const cleanup = (): void => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
      req.off('close', onClose)
      // Why: keep a neutral error sink so a late IncomingMessage error after cleanup can't become unhandled.
      req.on('error', ignoreSettledRequestError)
    }
    const settleResolve = (value: unknown): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(value)
    }
    const settleReject = (error: unknown): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(error)
    }
    const onData = (chunk: Buffer): void => {
      // Why: bound by bytes (not UTF-16 units) and stop accumulating after rejection so a client can't push memory past the cap.
      const nextByteLength = byteLength + chunk.length
      if (nextByteLength > HOOK_REQUEST_MAX_BYTES) {
        settleReject(new Error('payload too large'))
        req.destroy()
        return
      }
      if (retained.length < nextByteLength) {
        const nextCapacity = Math.min(
          HOOK_REQUEST_MAX_BYTES,
          Math.max(HOOK_REQUEST_INITIAL_BUFFER_BYTES, retained.length * 2, nextByteLength)
        )
        const next = Buffer.allocUnsafe(nextCapacity)
        retained.copy(next, 0, 0, byteLength)
        retained = next
      }
      chunk.copy(retained, byteLength)
      byteLength = nextByteLength
    }
    const onEnd = (): void => {
      try {
        const body = retained.toString('utf8', 0, byteLength)
        const contentType = req.headers['content-type'] ?? ''
        if (typeof contentType === 'string' && contentType.includes('application/json')) {
          settleResolve(body ? parseAgentHookJson(body) : {})
          return
        }
        if (
          typeof contentType === 'string' &&
          contentType.includes('application/x-www-form-urlencoded')
        ) {
          settleResolve(parseFormEncodedBody(body))
          return
        }
        // Why: managed scripts POST JSON, updated POSIX scripts form-encoded; default to JSON for unknown content types.
        settleResolve(body ? parseAgentHookJson(body) : {})
      } catch (error) {
        settleReject(error)
      }
    }
    const onError = (err: Error): void => {
      settleReject(err)
    }
    // Why: req.destroy() (slowloris timer) emits 'close' but not 'end'/'error'; without this the promise never settles and buffers leak.
    const onClose = (): void => {
      settleReject(new Error('aborted'))
    }
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
    req.on('close', onClose)
  })
}

function ignoreSettledRequestError(): void {}

// ─── Per-pane field caches + extractors ─────────────────────────────

type ExtractedPromptText = {
  text: string
  source:
    | 'prompt'
    | 'user_prompt'
    | 'userPrompt'
    | 'initial_prompt'
    | 'initialPrompt'
    | 'user_message'
    | 'message'
    | null
}

// Joins text of an Anthropic-style content-block array; returns '' when nothing textual so callers fall through to the next prompt source.
function contentBlockArrayText(value: unknown[]): string {
  const parts: string[] = []
  for (const item of value) {
    if (typeof item === 'string') {
      parts.push(item)
      continue
    }
    if (item && typeof item === 'object') {
      const text = (item as Record<string, unknown>).text
      if (typeof text === 'string') {
        parts.push(text)
      }
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

function extractPromptText(hookPayload: Record<string, unknown>): ExtractedPromptText {
  const candidateKeys = [
    'prompt',
    'user_prompt',
    'userPrompt',
    'initial_prompt',
    'initialPrompt',
    'user_message',
    'message'
  ]
  for (const key of candidateKeys) {
    const value = hookPayload[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      // Why: trim so prompts match readStringField output — whitespace would otherwise leak into UI and caches.
      return { text: value.trim(), source: key as Exclude<ExtractedPromptText['source'], null> }
    }
    // Why: some CLIs send `prompt` as a content-block array, not a string; extract it for real prompt keys but skip `message` (ambiguous status field).
    if (key !== 'message' && Array.isArray(value)) {
      const text = contentBlockArrayText(value)
      if (text.length > 0) {
        return { text, source: key as Exclude<ExtractedPromptText['source'], null> }
      }
    }
  }
  return { text: '', source: null }
}

// Why: the post-compact continuation prompt has no matching Stop and would resurrect working.
function shouldIgnoreCompactContinuationUserPromptSubmit(
  eventName: unknown,
  promptText: string
): boolean {
  return eventName === 'UserPromptSubmit' && isCompactContinuationUserTurnText(promptText)
}

function resolvePrompt(
  state: HookListenerState,
  paneKey: string,
  promptText: string,
  options?: { resetOnNewTurn?: boolean }
): string {
  // Why: harness-injected turns fire UserPromptSubmit but aren't the user's ask — keep cached prompt; match only known tags so real <tags> still reset the turn.
  if (isKnownHarnessInjectedUserTurnText(promptText)) {
    return state.lastPromptByPaneKey.get(paneKey) ?? ''
  }
  if (options?.resetOnNewTurn) {
    state.lastPromptByPaneKey.delete(paneKey)
  }
  if (promptText) {
    state.lastPromptByPaneKey.set(paneKey, promptText)
    return promptText
  }
  return state.lastPromptByPaneKey.get(paneKey) ?? ''
}

export type ToolSnapshot = {
  toolName?: string
  toolInput?: string
  /** Full JSON of an AskUserQuestion tool input; set only on its own event and NOT inherited (resolveToolState) so no stale prompt lingers. */
  interactivePrompt?: string
  hasToolUpdate?: boolean
  hasToolInputField?: boolean
  lastAssistantMessage?: string
  clearLastAssistantMessage?: boolean
}

function resolveToolState(
  state: HookListenerState,
  paneKey: string,
  update: ToolSnapshot,
  options: { resetOnNewTurn: boolean }
): ToolSnapshot {
  if (options.resetOnNewTurn) {
    state.lastToolByPaneKey.delete(paneKey)
  }
  const previous = state.lastToolByPaneKey.get(paneKey) ?? {}
  // Why: undefined means either "no update" or "input not previewable"; extractor metadata decides whether to inherit stale input.
  const clearsUnpreviewableInput =
    update.hasToolInputField === true && update.toolInput === undefined
  const clearsUnidentifiedTool =
    update.hasToolUpdate === true &&
    update.toolName === undefined &&
    update.hasToolInputField === true
  const toolName = clearsUnidentifiedTool ? undefined : (update.toolName ?? previous.toolName)
  const toolInput =
    clearsUnpreviewableInput ||
    (update.toolName !== undefined &&
      update.toolName !== previous.toolName &&
      update.toolInput === undefined)
      ? undefined
      : (update.toolInput ?? previous.toolInput)
  const merged: ToolSnapshot = {
    toolName,
    toolInput,
    // Why: don't inherit previous.interactivePrompt — valid only for its one AskUserQuestion event; carrying it forward leaves a stale live card.
    interactivePrompt: update.interactivePrompt,
    lastAssistantMessage: update.clearLastAssistantMessage
      ? undefined
      : (update.lastAssistantMessage ?? previous.lastAssistantMessage)
  }
  state.lastToolByPaneKey.set(paneKey, merged)
  return merged
}

const TOOL_INPUT_KEYS_BY_TOOL: Record<string, readonly string[]> = {
  Read: ['file_path', 'filePath', 'path'],
  Write: ['file_path', 'filePath', 'path'],
  Create: ['file_path', 'filePath', 'path'],
  Edit: ['file_path', 'filePath', 'path'],
  Execute: ['command'],
  MultiEdit: ['file_path', 'filePath', 'path'],
  NotebookEdit: ['file_path', 'filePath', 'path'],
  Bash: ['command'],
  Glob: ['pattern'],
  Grep: ['pattern'],
  WebFetch: ['url'],
  WebSearch: ['query'],
  FetchUrl: ['url'],
  read_file: ['file_path', 'path'],
  write_file: ['file_path', 'path'],
  read_many_files: ['file_path', 'paths', 'path'],
  edit_file: ['file_path', 'path'],
  replace: ['file_path', 'path'],
  run_shell_command: ['command'],
  run_command: ['CommandLine', 'command', 'cmd'],
  glob: ['pattern'],
  search_file_content: ['pattern'],
  web_fetch: ['url'],
  google_web_search: ['query'],
  exec_command: ['cmd', 'command'],
  shell_command: ['cmd', 'command'],
  run_terminal_cmd: ['command'],
  run_terminal_command: ['command'],
  search_replace: ['file_path', 'path', 'filePath'],
  write_to_file: ['TargetFile', 'path', 'file_path'],
  execute_code: ['code', 'command', 'cmd'],
  apply_patch: ['path', 'file_path'],
  view_image: ['path', 'file_path'],
  AskUser: ['question', 'prompt', 'message'],
  ask_user: ['question', 'prompt', 'message'],
  AskUserQuestion: ['questions', 'question', 'prompt', 'message'],
  ask_user_question: ['questions', 'question', 'prompt', 'message'],
  bash: ['command'],
  powershell: ['command'],
  create: ['path', 'file_path'],
  read: ['path', 'file_path'],
  write: ['path', 'file_path'],
  edit: ['path', 'file_path'],
  view: ['path', 'file_path'],
  grep: ['pattern'],
  web_search: ['query'],
  fetch_content: ['url'],
  terminal: ['command'],
  patch: ['path', 'file_path'],
  search_files: ['query', 'pattern', 'path'],
  browser_navigate: ['url'],
  browser_click: ['target', 'selector', 'text'],
  browser_type: ['text', 'target', 'selector'],
  session_search: ['query'],
  skill_manage: ['action', 'name', 'file_path'],
  delegate_task: ['task', 'prompt', 'description'],
  view_file: ['AbsolutePath', 'path', 'file_path'],
  replace_file_content: ['TargetFile', 'path', 'file_path'],
  multi_replace_file_content: ['TargetFile', 'path', 'file_path'],
  list_dir: ['DirectoryPath', 'path'],
  find_by_name: ['SearchDirectory', 'Pattern', 'query'],
  grep_search: ['SearchPath', 'Query', 'query', 'pattern'],
  search_web: ['query'],
  read_url_content: ['Url', 'url'],
  manage_task: ['TaskId', 'Action'],
  schedule: ['Prompt', 'DurationSeconds', 'CronExpression'],
  ask_question: ['question', 'questions'],
  ask_permission: ['Action', 'Target', 'Reason'],
  spawn_subagent: ['prompt', 'description', 'subagent_type'],
  open_page: ['url']
}

function deriveToolInputPreview(
  toolName: string | undefined,
  toolInput: unknown
): string | undefined {
  if (typeof toolInput === 'string') {
    return toolInput
  }
  if (typeof toolInput !== 'object' || toolInput === null) {
    return undefined
  }
  if (!toolName) {
    return undefined
  }
  const keys = TOOL_INPUT_KEYS_BY_TOOL[toolName]
  if (!keys) {
    return undefined
  }
  const record = toolInput as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value
    }
  }
  return undefined
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function hasOwnField(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function hasAnyOwnField(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((key) => hasOwnField(record, key))
}

function toolUpdate(
  fields: Pick<ToolSnapshot, 'toolName' | 'toolInput' | 'interactivePrompt'>,
  options?: { hasToolInputField?: boolean }
): ToolSnapshot {
  return {
    ...fields,
    hasToolUpdate: true,
    hasToolInputField: options?.hasToolInputField === true
  }
}

/** Clear active-tool metadata so a failed tool stops looking in-flight (else the compact sidebar hides the error behind the tool name). */
function clearActiveToolFieldsUpdate(): ToolSnapshot {
  return toolUpdate(
    { toolName: undefined, toolInput: undefined, interactivePrompt: undefined },
    { hasToolInputField: true }
  )
}

/** One-line description of a tool call for an approval card (Bash command, file path, else clipped JSON). */
function summarizeApprovalInput(toolInput: unknown): string {
  if (toolInput && typeof toolInput === 'object') {
    const obj = toolInput as Record<string, unknown>
    const direct = obj.command ?? obj.file_path ?? obj.path ?? obj.url ?? obj.pattern
    if (typeof direct === 'string' && direct.length > 0) {
      return direct.length > 200 ? `${direct.slice(0, 200)}…` : direct
    }
  }
  try {
    const json = JSON.stringify(toolInput) ?? ''
    return json.length > 200 ? `${json.slice(0, 200)}…` : json
  } catch {
    return ''
  }
}

/** Normalized JSON envelope for a pending prompt: AskUserQuestion → `{ questions }` (shape kept stable for back-compat); other tool on PermissionRequest → `{ approval }`; else undefined. */
function deriveInteractivePrompt(
  toolName: string | undefined,
  toolInput: unknown,
  eventName?: unknown
): string | undefined {
  // Why: providers vary casing; any post-tool event means the question is no longer pending — don't recreate its answered card.
  const normalizedEventName = normalizeHookEventName(eventName)
  const isPostToolEvent =
    normalizedEventName === 'post_tool_use' || normalizedEventName === 'post_tool_use_failure'
  if (
    isAskUserQuestionTool(toolName) &&
    !isPostToolEvent &&
    toolInput !== undefined &&
    toolInput !== null
  ) {
    try {
      return JSON.stringify(toolInput)
    } catch {
      // Why: circular/unserializable input from a buggy agent — a missing live card beats throwing in the hook hot path.
      return undefined
    }
  }
  if (eventName === 'PermissionRequest' && typeof toolName === 'string' && toolName.length > 0) {
    try {
      return JSON.stringify({
        approval: { tool: toolName, summary: summarizeApprovalInput(toolInput) }
      })
    } catch {
      return undefined
    }
  }
  return undefined
}

function readFirstString(
  record: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = readString(record, key)
    if (value) {
      return value
    }
  }
  return undefined
}

function extractToolResponseText(toolResponse: unknown): string | undefined {
  if (typeof toolResponse === 'string' && toolResponse.length > 0) {
    return toolResponse
  }
  if (typeof toolResponse !== 'object' || toolResponse === null) {
    return undefined
  }
  const record = toolResponse as Record<string, unknown>
  const directText = readFirstString(record, ['text_result_for_llm', 'textResultForLlm', 'text'])
  if (directText) {
    return directText
  }
  const content = record.content
  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === 'object' && part !== null) {
        const text = (part as Record<string, unknown>).text
        if (typeof text === 'string' && text.trim().length > 0) {
          return text
        }
      }
    }
  }
  return undefined
}

const TRANSCRIPT_CHUNK_BYTES = 64 * 1024
const TRANSCRIPT_MAX_SCAN_BYTES = 4 * 1024 * 1024
const EMPTY_TRANSCRIPT_REGION = Buffer.alloc(0)

function extractAssistantTextFromLine(line: string): string | undefined {
  let entry: unknown
  try {
    entry = parseAgentHookJson(line)
  } catch {
    return undefined
  }
  if (typeof entry !== 'object' || entry === null) {
    return undefined
  }
  const record = entry as Record<string, unknown>
  if (record.type === 'assistant.message') {
    const data = record.data
    if (typeof data === 'object' && data !== null) {
      const text = extractAssistantContentText((data as Record<string, unknown>).content)
      if (text) {
        return text
      }
    }
  }
  if (
    record.source === 'MODEL' &&
    record.type === 'PLANNER_RESPONSE' &&
    typeof record.content === 'string' &&
    record.content.trim().length > 0
  ) {
    return record.content
  }
  const nestedMessage = record.message as Record<string, unknown> | undefined
  const role =
    record.role ?? nestedMessage?.role ?? (record.type === 'assistant' ? 'assistant' : undefined)
  if (role !== 'assistant') {
    return undefined
  }
  const content = (nestedMessage ?? record).content
  return extractAssistantContentText(content)
}

function extractAssistantContentText(content: unknown): string | undefined {
  if (typeof content === 'string' && content.trim().length > 0) {
    return content
  }
  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === 'object' && part !== null) {
        const text = (part as Record<string, unknown>).text
        if (typeof text === 'string' && text.trim().length > 0) {
          return text
        }
      }
    }
  }
  return undefined
}

function readLastAssistantFromTranscript(transcriptPath: unknown): string | undefined {
  if (typeof transcriptPath !== 'string' || transcriptPath.length === 0) {
    return undefined
  }
  return readLastAssistantFromTranscriptOnce(transcriptPath)
}

function readLastAssistantFromTranscriptOnce(transcriptPath: string): string | undefined {
  return readLastTextFromTranscriptOnce(transcriptPath, extractAssistantTextFromLine)
}

function readLastTextFromTranscriptOnce(
  transcriptPath: string,
  extractLineText: (line: string) => string | undefined
): string | undefined {
  try {
    const stats = statSync(transcriptPath)
    const size = stats.size
    if (size <= 0) {
      return undefined
    }
    const fd = openSync(transcriptPath, 'r')
    try {
      // Why a chunk list: carry holds a partial line, and re-joining it per block
      // made one oversized line (a big tool result or pasted prompt) cost O(line^2).
      let carryChunks: Buffer[] = []
      let bytesRead = 0
      let scanEnd = size
      while (scanEnd > 0 && bytesRead < TRANSCRIPT_MAX_SCAN_BYTES) {
        const chunkSize = Math.min(scanEnd, TRANSCRIPT_CHUNK_BYTES)
        const position = scanEnd - chunkSize
        const buffer = Buffer.alloc(chunkSize)
        let filled = 0
        while (filled < chunkSize) {
          const n = readSync(fd, buffer, filled, chunkSize - filled, position + filled)
          if (n === 0) {
            break
          }
          filled += n
        }
        // Why bail on a short read: the file shrank under us, so the bytes above
        // this block no longer line up with what the earlier ones assumed.
        if (filled < chunkSize) {
          break
        }
        bytesRead += filled
        scanEnd = position
        // Why search only the new block: carry is always the run before a newline,
        // so it holds none of its own.
        const firstNewline = buffer.indexOf(0x0a)
        const atStart = position === 0
        let completeRegion: Buffer
        if (atStart) {
          completeRegion =
            carryChunks.length === 0 ? buffer : Buffer.concat([buffer, ...carryChunks])
          carryChunks = []
        } else if (firstNewline === -1) {
          completeRegion = EMPTY_TRANSCRIPT_REGION
          carryChunks.unshift(buffer)
        } else {
          const afterNewline = buffer.subarray(firstNewline + 1)
          completeRegion =
            carryChunks.length === 0 ? afterNewline : Buffer.concat([afterNewline, ...carryChunks])
          carryChunks = [buffer.subarray(0, firstNewline)]
        }
        if (completeRegion.length > 0) {
          const extracted = findLastExtractedTranscriptLineText(
            completeRegion.toString('utf8'),
            extractLineText
          )
          if (extracted !== undefined) {
            return extracted
          }
        }
      }
      return undefined
    } finally {
      closeSync(fd)
    }
  } catch {
    return undefined
  }
}

function findLastExtractedTranscriptLineText(
  text: string,
  extractLineText: (line: string) => string | undefined
): string | undefined {
  let lineEnd = text.length

  for (let index = text.length - 1; index >= -1; index--) {
    if (index >= 0 && text.charCodeAt(index) !== 10) {
      continue
    }

    const line = text.slice(index + 1, lineEnd).trim()
    if (line.length > 0) {
      const extracted = extractLineText(line)
      if (extracted !== undefined) {
        return extracted
      }
    }
    lineEnd = index
  }

  return undefined
}

function extractClaudeToolFields(
  eventName: unknown,
  hookPayload: Record<string, unknown>
): ToolSnapshot {
  const update: ToolSnapshot = {}
  if (eventName === 'PostToolUseFailure') {
    Object.assign(update, clearActiveToolFieldsUpdate())
  } else if (
    eventName === 'PreToolUse' ||
    eventName === 'PostToolUse' ||
    eventName === 'PermissionRequest'
  ) {
    const toolName = readString(hookPayload, 'tool_name')
    Object.assign(
      update,
      toolUpdate(
        {
          toolName,
          toolInput: deriveToolInputPreview(toolName, hookPayload.tool_input),
          interactivePrompt: deriveInteractivePrompt(toolName, hookPayload.tool_input, eventName)
        },
        { hasToolInputField: hasOwnField(hookPayload, 'tool_input') }
      )
    )
  }
  if (eventName === 'PostToolUse') {
    const responseText = extractToolResponseText(hookPayload.tool_response)
    if (responseText) {
      update.lastAssistantMessage = responseText
    }
  }
  if (eventName === 'PostToolUseFailure') {
    const errorText =
      extractToolResponseText(hookPayload.tool_response) ??
      readString(hookPayload, 'error') ??
      readString(hookPayload, 'message')
    if (errorText) {
      update.lastAssistantMessage = errorText
    }
  }
  if (eventName === 'Stop') {
    const direct = readString(hookPayload, 'last_assistant_message')
    if (direct) {
      update.lastAssistantMessage = direct
    } else {
      const lastFromTranscript = readLastAssistantFromTranscript(hookPayload.transcript_path)
      if (lastFromTranscript) {
        update.lastAssistantMessage = lastFromTranscript
      }
    }
  }
  return update
}

function extractCodexToolFields(
  eventName: unknown,
  hookPayload: Record<string, unknown>
): ToolSnapshot {
  if (
    eventName === 'PreToolUse' ||
    eventName === 'PermissionRequest' ||
    eventName === 'PostToolUse'
  ) {
    const toolName = readString(hookPayload, 'tool_name') ?? readString(hookPayload, 'name')
    const rawInput = hookPayload.tool_input ?? hookPayload.input ?? hookPayload.arguments
    const toolInput =
      deriveToolInputPreview(toolName, hookPayload.tool_input) ??
      deriveToolInputPreview(toolName, hookPayload.input) ??
      deriveToolInputPreview(toolName, hookPayload.arguments)
    return toolUpdate(
      {
        toolName,
        toolInput,
        interactivePrompt: deriveInteractivePrompt(toolName, rawInput, eventName)
      },
      { hasToolInputField: hasAnyOwnField(hookPayload, ['tool_input', 'input', 'arguments']) }
    )
  }
  if (eventName === 'Stop') {
    const message = readString(hookPayload, 'last_assistant_message')
    if (message) {
      return { lastAssistantMessage: message }
    }
  }
  return {}
}

function normalizeHookEventName(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase()
}

function isNewTurnEvent(source: AgentHookSource, eventName: unknown): boolean {
  // Why: exhaustive switch so a new AgentHookSource fails typecheck here instead of falling through to false.
  switch (source) {
    case 'claude':
      // Why: SessionStart lands an idle row (STA-3386) and must also drop stale
      // tool/prompt caches left by the pane's previous session.
      return eventName === 'SessionStart' || eventName === 'UserPromptSubmit'
    case 'codex':
      return eventName === 'SessionStart' || eventName === 'UserPromptSubmit'
  }
}

function hasExplicitUserPrompt(
  source: AgentHookSource,
  eventName: unknown,
  extractedPrompt: ExtractedPromptText
): boolean {
  if (extractedPrompt.text.length === 0) {
    return false
  }
  // Why: harness-injected turns aren't a user submit (no prompt-sent telemetry or permission stickiness); match only KNOWN tags so a real `<my-element>` prompt still counts and survives interrupt recovery.
  if (isKnownHarnessInjectedUserTurnText(extractedPrompt.text)) {
    return false
  }
  // Why: bare `message` fields often carry permission/status copy — may update visible status prompts but aren't proof of a user submit.
  if (extractedPrompt.source === 'message') {
    return false
  }
  if (
    extractedPrompt.source === 'user_prompt' ||
    extractedPrompt.source === 'userPrompt' ||
    extractedPrompt.source === 'user_message'
  ) {
    return isNewTurnEvent(source, eventName)
  }
  return isNewTurnEvent(source, eventName)
}

function extractToolFields(
  source: AgentHookSource,
  eventName: unknown,
  hookPayload: Record<string, unknown>
): ToolSnapshot {
  // Why: exhaustive switch so a new AgentHookSource fails typecheck here instead of silently routing through another extractor.
  switch (source) {
    case 'claude':
      return extractClaudeToolFields(eventName, hookPayload)
    case 'codex':
      return extractCodexToolFields(eventName, hookPayload)
  }
}

function getOrCreateClaudeSubagentRoster(
  state: HookListenerState,
  paneKey: string
): ClaudeSubagentRoster {
  let roster = state.claudeSubagentRosterByPaneKey.get(paneKey)
  if (!roster) {
    roster = new Map()
    state.claudeSubagentRosterByPaneKey.set(paneKey, roster)
  }
  return roster
}

function updateClaudeRunningNonAgentTask(
  state: HookListenerState,
  paneKey: string,
  hasRunningNonAgentTask: boolean,
  interrupted: boolean
): void {
  if (hasRunningNonAgentTask && !interrupted) {
    state.claudeRunningNonAgentTaskPaneKeys.add(paneKey)
  } else {
    state.claudeRunningNonAgentTaskPaneKeys.delete(paneKey)
  }
}

function resolveClaudePaneState(
  state: HookListenerState,
  paneKey: string,
  lead: Pick<ClaudeLeadTurnState, 'state' | 'interrupted'>
): AgentStatusState {
  if (lead.state !== 'done') {
    return lead.state
  }
  const roster = state.claudeSubagentRosterByPaneKey.get(paneKey)
  return claudeRosterHasWorkingSubagent(roster) ||
    (!lead.interrupted &&
      (state.claudeRunningNonAgentTaskPaneKeys.has(paneKey) ||
        state.claudeActiveSessionCronPaneKeys.has(paneKey)))
    ? 'working'
    : 'done'
}

/** SubagentStart/Stop/TeammateIdle update the roster and re-emit the lead's last known state with the fresh child list, so the sidebar reflects spawn/finish even when a background child outlives the lead turn with no other hook traffic. */
function normalizeClaudeSubagentLifecycleEvent(
  state: HookListenerState,
  eventName: 'SubagentStart' | 'SubagentStop' | 'TeammateIdle',
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  const lifecycleField = eventName === 'TeammateIdle' ? 'teammate_name' : 'agent_id'
  const lifecycleId = readString(hookPayload, lifecycleField)
  if (!lifecycleId) {
    return null
  }
  const roster = getOrCreateClaudeSubagentRoster(state, paneKey)
  if (eventName === 'TeammateIdle') {
    const teammateName = lifecycleId
    // Why: on claude 2.1.21x teammates are turn-based — TeammateIdle means "turn over, awaiting mail", not finished. The row parks as idle (confirmed teammate) instead of leaving, so the sidebar keeps showing resumable children.
    idleClaudeTeammateByName(roster, teammateName)
    clearClaudePendingWaitForAgent(state, paneKey, (waitingAgentId) =>
      claudeTeammateIdMatchesName(waitingAgentId, teammateName)
    )
  } else {
    const agentId = lifecycleId
    if (eventName === 'SubagentStart') {
      upsertWorkingClaudeSubagent(
        roster,
        agentId,
        { agentType: readString(hookPayload, 'agent_type') },
        Date.now()
      )
    } else {
      // Why: one-shot stops are true finishes (row removed); teammate-shaped stops are turn ends on 2.1.21x — the row parks idle and a later SubagentStart revives it.
      stopClaudeSubagent(roster, agentId)
      // Why: a blocked child that dies without another tool event would pin its permission/question wait on the pane forever — nothing else references that agent again.
      clearClaudePendingWaitForAgent(state, paneKey, (waitingAgentId) => waitingAgentId === agentId)
    }
  }
  return buildClaudeChildDrivenStatusPayload(state, eventName, paneKey, hookPayload)
}

/** Sync the Claude lead-turn record when the SERVER infers an interrupt outside the hook stream (Ctrl+C with a missed Stop); else a later child lifecycle event resurrects the cancelled pane. */
export function markClaudeLeadTurnInterrupted(state: HookListenerState, paneKey: string): void {
  state.claudeLeadStateByPaneKey.set(paneKey, { state: 'done', interrupted: true })
  state.claudeRunningNonAgentTaskPaneKeys.delete(paneKey)
  state.claudeActiveSessionCronPaneKeys.delete(paneKey)
}

/** Rebuild a pane's working roster from a persisted snapshot; live activity confirms a seed, a complete task inventory may reap an unconfirmed one whose finish hook arrived while Orca was offline. */
export function seedClaudeSubagentRosterFromSnapshots(
  state: HookListenerState,
  paneKey: string,
  snapshots: readonly AgentSubagentSnapshot[]
): void {
  if (snapshots.length === 0 || state.claudeSubagentRosterByPaneKey.has(paneKey)) {
    return
  }
  const roster = getOrCreateClaudeSubagentRoster(state, paneKey)
  for (const snapshot of snapshots) {
    // Why: idle-teammate liveness can't be proven across a restart (its TeammateIdle confirmation is gone); only working seeds restore, and a live teammate re-earns its row via SubagentStart.
    if (snapshot.state !== 'working') {
      continue
    }
    roster.set(snapshot.id, {
      state: 'working',
      startedAt: snapshot.startedAt,
      agentType: snapshot.agentType,
      description: snapshot.description,
      // Why: the seed can be a phantom (child finished while Orca was down, SubagentStop lost); let a PRESENT background_tasks list omitting the id remove it, not gate the pane 'working' forever.
      backgroundTasksAuthoritative: true,
      // Why: an idle parent never emits that list, so the inventory reap alone can strand the seed; mark it for the liveness reap below.
      restoredFromSnapshot: true
    })
  }
}

/** Reap this pane's unconfirmed restored seeds because no live agent process backs
 *  the pane any more (its PTY died while Orca was down, so no finish hook could
 *  arrive). Callers must have proven the pane is LOCAL-launched — a remote/SSH
 *  agent runs on the far host and can never appear in a local process index.
 *  Returns whether the roster changed. */
export function reapRestoredClaudeSubagentsForDeadPane(
  state: HookListenerState,
  paneKey: string
): boolean {
  const roster = state.claudeSubagentRosterByPaneKey.get(paneKey)
  if (!roster || !reapRestoredClaudeSubagentsWithoutLiveAgent(roster)) {
    return false
  }
  if (roster.size === 0) {
    state.claudeSubagentRosterByPaneKey.delete(paneKey)
  }
  return true
}

/** Drop a child-owned waiting state when the child stops/idles, restoring the displaced lead state; without a stash, fall back to 'working' (a transient spinner beats a permanently stuck card). */
function clearClaudePendingWaitForAgent(
  state: HookListenerState,
  paneKey: string,
  ownsWait: (waitingAgentId: string) => boolean
): void {
  const lead = state.claudeLeadStateByPaneKey.get(paneKey)
  if (lead?.state !== 'waiting' || !lead.waitingAgentId || !ownsWait(lead.waitingAgentId)) {
    return
  }
  state.claudeLeadStateByPaneKey.set(paneKey, lead.stateBeforeWait ?? { state: 'working' })
}

/** Clear an AskUserQuestion wait after the answer is typed (answering emits no hook event; the caller infers it from the submit keystroke). Restores the stashed pre-wait lead state or 'working', drops the cached card, and returns the pane state to emit (gated up to 'working' while children run). */
export function clearClaudeAnsweredQuestionWait(
  state: HookListenerState,
  paneKey: string
): Pick<ClaudeLeadTurnState, 'state' | 'interrupted'> {
  const lead = state.claudeLeadStateByPaneKey.get(paneKey)
  const restored =
    lead?.state === 'waiting'
      ? (lead.stateBeforeWait ?? { state: 'working' as const })
      : { state: 'working' as const }
  state.claudeLeadStateByPaneKey.set(paneKey, { ...restored })
  const previousTool = state.lastToolByPaneKey.get(paneKey)
  state.lastToolByPaneKey.set(
    paneKey,
    previousTool?.lastAssistantMessage
      ? { lastAssistantMessage: previousTool.lastAssistantMessage }
      : {}
  )
  const effectiveState = resolveClaudePaneState(state, paneKey, restored)
  return effectiveState === restored.state ? restored : { state: effectiveState }
}

/** Re-emit the lead's cached state on child activity — gated up to 'working' while a child works — without touching the lead's tool/prompt caches, so a live card or permission wait survives child churn. */
function buildClaudeChildDrivenStatusPayload(
  state: HookListenerState,
  eventName: unknown,
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  // Why: default 'working' — a spawn proves activity even before the lead's first state-bearing event (e.g. Orca restarted mid-session).
  const lead = state.claudeLeadStateByPaneKey.get(paneKey)
  const leadState = lead?.state ?? 'working'
  return buildClaudeStatusPayload(state, eventName, '', paneKey, hookPayload, {
    stateName: resolveClaudePaneState(state, paneKey, {
      state: leadState,
      interrupted: lead?.interrupted
    }),
    updateToolSnapshot: false,
    interrupted: lead?.interrupted
  })
}

function normalizeClaudeEvent(
  state: HookListenerState,
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  const eventAgentId = readString(hookPayload, 'agent_id')
  if (
    eventName === 'SubagentStart' ||
    eventName === 'SubagentStop' ||
    eventName === 'TeammateIdle'
  ) {
    return normalizeClaudeSubagentLifecycleEvent(state, eventName, paneKey, hookPayload)
  }
  if (eventName === 'SessionStart') {
    // Why: SessionStart is the only signal a resumed session emits before its first prompt
    // (STA-3386). Land it as a session-boundary 'done' row: 'working' would show a phantom
    // spinner on an idle TUI (why Devin/Pi/Grok drop the event), and the sessionBoundary
    // flag keeps completion-reactive consumers (notifications, automation runs) out of it.
    const sessionStartSource = hookPayload['source']
    if (
      eventAgentId !== undefined ||
      (sessionStartSource !== 'startup' &&
        sessionStartSource !== 'resume' &&
        sessionStartSource !== 'clear')
    ) {
      // Why: allowlist idle boundaries and fail closed — a compact restart (or any unknown
      // source) fires mid-turn, and a child-attributed SessionStart must not flip the lead's
      // live turn to an idle row.
      return null
    }
    // Why: a new process owns the pane; stale children/tasks/crons must not gate the
    // fresh session's idle row back up to 'working' (same reset Codex does on SessionStart).
    state.claudeSubagentRosterByPaneKey.delete(paneKey)
    state.claudeRunningNonAgentTaskPaneKeys.delete(paneKey)
    state.claudeActiveSessionCronPaneKeys.delete(paneKey)
    state.claudeLeadStateByPaneKey.set(paneKey, { state: 'done' })
    return buildClaudeStatusPayload(state, eventName, promptText, paneKey, hookPayload, {
      stateName: 'done',
      updateToolSnapshot: true,
      sessionBoundary: true
    })
  }
  const previousLead = state.claudeLeadStateByPaneKey.get(paneKey)
  // Why: only a turn boundary may declare an interrupt or carry a prior one forward; any other event starts a fresh turn and drops it.
  const isTurnBoundary = eventName === 'Stop' || eventName === 'StopFailure'
  const interrupted =
    isTurnBoundary &&
    ((eventAgentId === undefined && hookPayload['is_interrupt'] === true) ||
      previousLead?.interrupted === true)
      ? true
      : undefined
  const backgroundTasks = readClaudeBackgroundAgentTasks(hookPayload)
  const sessionCrons = hookPayload['session_crons']
  const sessionCronInventoryPresent = Array.isArray(sessionCrons)
  const hasActiveSessionCron = sessionCronInventoryPresent && sessionCrons.length > 0

  if (shouldIgnoreCompactContinuationUserPromptSubmit(eventName, promptText)) {
    return null
  }

  // Why: Claude's auto-allowed AskUserQuestion emits PreToolUse (not PermissionRequest; its Notification hook isn't registered) while blocked on a human answer.
  // Treat that PreToolUse as waiting so the sidebar shows amber attention, not a spinner that decays to grey. 
  const isAskUserQuestion =
    eventName === 'PreToolUse' && isAskUserQuestionTool(readString(hookPayload, 'tool_name'))
  // Why: /compact can take minutes and does not emit Stop. PreCompact marks the pane busy;
  // PostCompact clears it so a finished compact cannot leave a sticky working spinner (#11352).
  const reportedStateName =
    eventName === 'UserPromptSubmit' ||
    eventName === 'PostToolUse' ||
    eventName === 'PostToolUseFailure' ||
    eventName === 'PreCompact' ||
    (eventName === 'PostCompact' && hookPayload.trigger === 'auto') ||
    (eventName === 'PreToolUse' && !isAskUserQuestion)
      ? 'working'
      : eventName === 'PermissionRequest' || isAskUserQuestion
        ? 'waiting'
        : isTurnBoundary || (eventName === 'PostCompact' && hookPayload.trigger === 'manual')
          ? 'done'
          : null

  if (!reportedStateName) {
    return null
  }
  if (backgroundTasks.present && eventAgentId === undefined) {
    updateClaudeRunningNonAgentTask(
      state,
      paneKey,
      backgroundTasks.hasRunningNonAgentTask,
      interrupted === true
    )
  }
  if (sessionCronInventoryPresent && eventAgentId === undefined) {
    if (hasActiveSessionCron && interrupted !== true) {
      state.claudeActiveSessionCronPaneKeys.add(paneKey)
    } else {
      state.claudeActiveSessionCronPaneKeys.delete(paneKey)
    }
  } else if (eventAgentId === undefined && isTurnBoundary && backgroundTasks.present) {
    // Why: current Claude may omit an empty cron inventory while still emitting background_tasks.
    state.claudeActiveSessionCronPaneKeys.delete(paneKey)
  }

  // Why: subagent/teammate events carry `agent_id` (lead's don't); child tool activity keeps its row live but must not become the lead's state or overwrite its tool/prompt caches (a live card would vanish).
  // Two exceptions take the full path below: waiting-inducing events (a child needs human attention on this pane) and the blocked child's own next tool event (approval granted — clear the wait as for the lead).
  const isWaitingInducing = reportedStateName === 'waiting'
  const subagentOriginId =
    !isWaitingInducing &&
    (eventName === 'PreToolUse' ||
      eventName === 'PostToolUse' ||
      eventName === 'PostToolUseFailure')
      ? eventAgentId
      : undefined
  if (eventAgentId && (subagentOriginId || isWaitingInducing)) {
    upsertWorkingClaudeSubagent(
      getOrCreateClaudeSubagentRoster(state, paneKey),
      eventAgentId,
      { agentType: readString(hookPayload, 'agent_type') },
      Date.now()
    )
  }
  if (subagentOriginId) {
    const lead = state.claudeLeadStateByPaneKey.get(paneKey)
    if (lead?.state !== 'waiting' || lead.waitingAgentId !== subagentOriginId) {
      return buildClaudeChildDrivenStatusPayload(state, eventName, paneKey, hookPayload)
    }
    // Why: approval granted — update the tool snapshot (drop the pending card) as the lead's own next tool event would.
    // Restore the stashed lead state, not this child's 'working': the lead may already be done, and the done-gate never upgrades working back to done once the roster drains.
    const restored = lead.stateBeforeWait ?? { state: 'working' as const }
    state.claudeLeadStateByPaneKey.set(paneKey, restored)
    return buildClaudeStatusPayload(state, eventName, promptText, paneKey, hookPayload, {
      stateName: resolveClaudePaneState(state, paneKey, restored),
      updateToolSnapshot: true,
      interrupted: restored.interrupted
    })
  }

  // Why: lead events never carry agent_id; even a child missed by lifecycle tracking cannot own the lead turn or its background-work evidence.
  if (eventAgentId && !isWaitingInducing) {
    return buildClaudeChildDrivenStatusPayload(state, eventName, paneKey, hookPayload)
  }

  if (isTurnBoundary && eventAgentId === undefined) {
    // Why: background_tasks is trusted only where unambiguous (see foldClaudeBackgroundTasksIntoRoster) — teammates report "running" here even while idle.
    // Older Claude builds without the field keep the incrementally tracked roster.
    if (backgroundTasks.present) {
      foldClaudeBackgroundTasksIntoRoster(
        getOrCreateClaudeSubagentRoster(state, paneKey),
        backgroundTasks.tasks,
        Date.now(),
        { inventoryComplete: !backgroundTasks.truncated }
      )
    }
  }
  // Why: a child-induced wait displaces the lead state; stash it so clearing restores reality (lead may be done). A 2nd child wait carries the ORIGINAL stash, not the intermediate waiting state.
  const stateBeforeWait =
    isWaitingInducing && eventAgentId && previousLead
      ? previousLead.state === 'waiting'
        ? previousLead.stateBeforeWait
        : {
            state: previousLead.state,
            ...(previousLead.interrupted ? { interrupted: true as const } : {})
          }
      : undefined
  state.claudeLeadStateByPaneKey.set(paneKey, {
    state: reportedStateName,
    ...(interrupted ? { interrupted } : {}),
    ...(isWaitingInducing && eventAgentId ? { waitingAgentId: eventAgentId } : {}),
    ...(stateBeforeWait ? { stateBeforeWait } : {})
  })

  if (interrupted && eventAgentId === undefined) {
    state.claudeRunningNonAgentTaskPaneKeys.delete(paneKey)
    state.claudeActiveSessionCronPaneKeys.delete(paneKey)
  }

  const effectiveState = resolveClaudePaneState(state, paneKey, {
    state: reportedStateName,
    interrupted
  })

  return buildClaudeStatusPayload(state, eventName, promptText, paneKey, hookPayload, {
    stateName: effectiveState,
    updateToolSnapshot: true,
    interrupted
  })
}

function buildClaudeStatusPayload(
  state: HookListenerState,
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>,
  options: {
    stateName: AgentStatusState
    updateToolSnapshot: boolean
    interrupted?: boolean
    sessionBoundary?: boolean
  }
): ParsedAgentStatusPayload | null {
  // Why: child-driven refreshes are roster bookkeeping, not lead tool activity; read the cached snapshot without merging so they can't clear a live AskUserQuestion card or clobber the tool preview.
  const snapshot = options.updateToolSnapshot
    ? resolveToolState(state, paneKey, extractToolFields('claude', eventName, hookPayload), {
        resetOnNewTurn: isNewTurnEvent('claude', eventName)
      })
    : (state.lastToolByPaneKey.get(paneKey) ?? {})

  // Why: validate directly — the JSON stringify/parse round trip other normalizers use is pure overhead on this hot per-hook path.
  // The normalizer clamps `interrupted` to done payloads, so a gated 'working' emit drops it; claudeLeadStateByPaneKey preserves it for the eventual done.
  return normalizeAgentStatusPayload({
    state: options.stateName,
    // Why: only lead-origin events may reset the prompt cache; a child-driven refresh must not blank the lead's prompt label.
    prompt: resolvePrompt(state, paneKey, promptText, {
      resetOnNewTurn: options.updateToolSnapshot && isNewTurnEvent('claude', eventName)
    }),
    agentType: 'claude',
    toolName: snapshot.toolName,
    toolInput: snapshot.toolInput,
    interactivePrompt: snapshot.interactivePrompt,
    lastAssistantMessage: snapshot.lastAssistantMessage,
    interrupted: options.interrupted,
    sessionBoundary: options.sessionBoundary,
    subagents: claudeRosterToSnapshots(state.claudeSubagentRosterByPaneKey.get(paneKey))
  })
}

function getOrCreateCodexSubagentRoster(
  state: HookListenerState,
  paneKey: string
): CodexSubagentRoster {
  let roster = state.codexSubagentRosterByPaneKey.get(paneKey)
  if (!roster) {
    roster = new Map()
    state.codexSubagentRosterByPaneKey.set(paneKey, roster)
  }
  return roster
}

function getOrCreateCodexSubagentTranscriptState(
  state: HookListenerState,
  paneKey: string
): CodexSubagentTranscriptState {
  let transcriptState = state.codexSubagentTranscriptByPaneKey.get(paneKey)
  if (!transcriptState) {
    transcriptState = createCodexSubagentTranscriptState()
    state.codexSubagentTranscriptByPaneKey.set(paneKey, transcriptState)
  }
  return transcriptState
}

export function hasCodexTranscriptSubagents(state: HookListenerState, paneKey: string): boolean {
  return hasTrackedCodexTranscriptSubagents(state.codexSubagentTranscriptByPaneKey.get(paneKey))
}

export function seedCodexStateFromSnapshot(
  state: HookListenerState,
  paneKey: string,
  payload: Pick<ParsedAgentStatusPayload, 'model' | 'state' | 'subagents'>
): void {
  const snapshots = payload.subagents ?? []
  if (snapshots.length > 0 && !state.codexSubagentRosterByPaneKey.has(paneKey)) {
    seedCodexSubagentRoster(getOrCreateCodexSubagentRoster(state, paneKey), snapshots)
  }
  if (!state.codexLeadStateByPaneKey.has(paneKey)) {
    // Why: child hooks after restart omit the root model; seed it from durable status before they can overwrite the cache.
    state.codexLeadStateByPaneKey.set(paneKey, {
      // Why: a child wait drives the aggregate waiting state, so it is not evidence that the root itself was waiting.
      state:
        payload.state === 'done'
          ? 'done'
          : payload.state === 'waiting' &&
              !snapshots.some((snapshot) => snapshot.state === 'waiting')
            ? 'waiting'
            : 'working',
      model: payload.model
    })
  }
}

/** Sync the Codex lead record when the server infers an interrupt, so delayed child events cannot restore stale working state. */
export function markCodexLeadTurnInterrupted(state: HookListenerState, paneKey: string): void {
  const lead = state.codexLeadStateByPaneKey.get(paneKey)
  state.codexLeadStateByPaneKey.set(paneKey, { state: 'done', model: lead?.model })
}

function codexLeadStateForHookEvent(
  eventName: string | undefined
): CodexLeadTurnState['state'] | undefined {
  if (eventName === 'Stop') {
    return 'done'
  }
  if (eventName === 'PermissionRequest') {
    return 'waiting'
  }
  if (
    eventName === 'SessionStart' ||
    eventName === 'UserPromptSubmit' ||
    eventName === 'PreToolUse' ||
    eventName === 'PostToolUse'
  ) {
    return 'working'
  }
  return undefined
}

/** Why: relay restarts lose lead/roster state; merge child events into main's longer-lived cache. */
export function reconcileRemoteCodexState(
  state: HookListenerState,
  paneKey: string,
  eventName: string | undefined,
  agentId: string | undefined,
  payload: ParsedAgentStatusPayload,
  previous: ParsedAgentStatusPayload | undefined
): ParsedAgentStatusPayload {
  if (previous?.agentType === 'codex') {
    seedCodexStateFromSnapshot(state, paneKey, previous)
  } else {
    seedCodexStateFromSnapshot(state, paneKey, payload)
  }

  // Why: older relays send child identity without roster snapshots; keep their already-normalized aggregate authoritative.
  if (agentId && !payload.subagents && !state.codexSubagentRosterByPaneKey.has(paneKey)) {
    return payload
  }
  const roster = getOrCreateCodexSubagentRoster(state, paneKey)
  if (payload.subagents) {
    seedCodexSubagentRoster(roster, payload.subagents)
  }
  if (agentId) {
    if (eventName === 'SubagentStop') {
      finishCodexSubagent(roster, agentId)
    }
  } else {
    const leadState = codexLeadStateForHookEvent(eventName)
    if (eventName === 'SessionStart' || (eventName === 'Stop' && !payload.subagents)) {
      roster.clear()
    }
    if (leadState) {
      const previousLead = state.codexLeadStateByPaneKey.get(paneKey)
      state.codexLeadStateByPaneKey.set(paneKey, {
        state: leadState,
        model: payload.model ?? previousLead?.model
      })
    }
  }

  const lead = state.codexLeadStateByPaneKey.get(paneKey)
  if (!lead) {
    return payload
  }
  return {
    ...payload,
    state: codexRosterEffectiveState(roster, lead.state),
    model: lead.model ?? payload.model,
    subagents: codexRosterToSnapshots(roster)
  }
}

function buildCodexStatusPayload(
  state: HookListenerState,
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>,
  options: { stateName: 'working' | 'waiting' | 'done'; updateLead: boolean }
): ParsedAgentStatusPayload | null {
  const snapshot = options.updateLead
    ? resolveToolState(state, paneKey, extractToolFields('codex', eventName, hookPayload), {
        resetOnNewTurn: isNewTurnEvent('codex', eventName)
      })
    : (state.lastToolByPaneKey.get(paneKey) ?? {})
  const lead = state.codexLeadStateByPaneKey.get(paneKey)

  return normalizeAgentStatusPayload({
    state: options.stateName,
    prompt: resolvePrompt(state, paneKey, promptText, {
      resetOnNewTurn: options.updateLead && isNewTurnEvent('codex', eventName)
    }),
    agentType: 'codex',
    model: lead?.model,
    toolName: snapshot.toolName,
    toolInput: snapshot.toolInput,
    interactivePrompt: snapshot.interactivePrompt,
    lastAssistantMessage: snapshot.lastAssistantMessage,
    subagents: codexRosterToSnapshots(state.codexSubagentRosterByPaneKey.get(paneKey))
  })
}

function buildCodexChildDrivenStatusPayload(
  state: HookListenerState,
  eventName: unknown,
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  const leadState = state.codexLeadStateByPaneKey.get(paneKey)?.state ?? 'working'
  const stateName = codexRosterEffectiveState(
    state.codexSubagentRosterByPaneKey.get(paneKey),
    leadState
  )
  return buildCodexStatusPayload(state, eventName, '', paneKey, hookPayload, {
    stateName,
    updateLead: false
  })
}

function normalizeCodexSubagentLifecycleEvent(
  state: HookListenerState,
  eventName: 'SubagentStart' | 'SubagentStop',
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  const agentId = readString(hookPayload, 'agent_id')
  if (!agentId) {
    return null
  }
  const roster = getOrCreateCodexSubagentRoster(state, paneKey)
  if (eventName === 'SubagentStart') {
    upsertCodexSubagent(
      roster,
      agentId,
      {
        agentType: readString(hookPayload, 'agent_type'),
        model: readString(hookPayload, 'model'),
        state: 'working'
      },
      Date.now()
    )
  } else {
    finishCodexSubagent(roster, agentId)
  }
  return buildCodexChildDrivenStatusPayload(state, eventName, paneKey, hookPayload)
}

function normalizeCodexEvent(
  state: HookListenerState,
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  if (eventName === 'SubagentStart' || eventName === 'SubagentStop') {
    return normalizeCodexSubagentLifecycleEvent(state, eventName, paneKey, hookPayload)
  }

  // Why: Codex's request_user_input (0.145+) is auto-allowed, so it fires PreToolUse while blocked on a human answer; map to waiting like grok's ask_user_question.
  const isUserInputPreTool =
    eventName === 'PreToolUse' &&
    isAskUserQuestionTool(readString(hookPayload, 'tool_name') ?? readString(hookPayload, 'name'))
  const stateName =
    eventName === 'SessionStart' ||
    eventName === 'UserPromptSubmit' ||
    (eventName === 'PreToolUse' && !isUserInputPreTool) ||
    eventName === 'PostToolUse'
      ? 'working'
      : eventName === 'PermissionRequest' || isUserInputPreTool
        ? 'waiting'
        : eventName === 'Stop'
          ? 'done'
          : null
  if (!stateName) {
    return null
  }

  const agentId = readString(hookPayload, 'agent_id')
  if (agentId) {
    upsertCodexSubagent(
      getOrCreateCodexSubagentRoster(state, paneKey),
      agentId,
      {
        agentType: readString(hookPayload, 'agent_type'),
        model: readString(hookPayload, 'model'),
        state: stateName === 'waiting' ? 'waiting' : 'working'
      },
      Date.now()
    )
    return buildCodexChildDrivenStatusPayload(state, eventName, paneKey, hookPayload)
  }

  if (eventName === 'SessionStart') {
    // Why: a pane can host a new Codex process after the old one exited without child Stop hooks.
    state.codexSubagentRosterByPaneKey.delete(paneKey)
    state.codexSubagentTranscriptByPaneKey.delete(paneKey)
  }
  const transcriptPath = readFirstString(hookPayload, ['transcript_path', 'transcriptPath'])
  if (transcriptPath) {
    reconcileCodexSubagentTranscript(
      getOrCreateCodexSubagentTranscriptState(state, paneKey),
      getOrCreateCodexSubagentRoster(state, paneKey),
      transcriptPath
    )
  }
  if (eventName === 'Stop' && !hasCodexTranscriptSubagents(state, paneKey)) {
    // Why: Codex CLI 0.144 can omit child Stop hooks; later child activity safely recreates any agent still running.
    state.codexSubagentRosterByPaneKey.delete(paneKey)
  }
  const previousLead = state.codexLeadStateByPaneKey.get(paneKey)
  state.codexLeadStateByPaneKey.set(paneKey, {
    state: stateName,
    model:
      normalizeOptionalField(hookPayload['model'], AGENT_MODEL_MAX_LENGTH) ??
      (eventName === 'SessionStart' ? undefined : previousLead?.model)
  })
  const effectiveState = codexRosterEffectiveState(
    state.codexSubagentRosterByPaneKey.get(paneKey),
    stateName
  )
  return buildCodexStatusPayload(state, eventName, promptText, paneKey, hookPayload, {
    stateName: effectiveState,
    updateLead: true
  })
}

function readStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function normalizeHookPayload(
  state: HookListenerState,
  source: AgentHookSource,
  body: unknown,
  expectedEnv: string,
  options: { allowUnanchoredPreCompact?: boolean; allowUnanchoredPostCompact?: boolean } = {}
): AgentHookEventPayload | null {
  if (typeof body !== 'object' || body === null) {
    return null
  }

  const record = body as Record<string, unknown>
  const paneKey = typeof record.paneKey === 'string' ? record.paneKey.trim() : ''
  const parsedPaneKey = parsePaneKey(paneKey)
  const rawPayload = record.payload
  const hookPayload =
    typeof rawPayload === 'string'
      ? (() => {
          try {
            return parseAgentHookJson(rawPayload)
          } catch {
            return null
          }
        })()
      : rawPayload
  if (
    !paneKey ||
    paneKey.length > MAX_PANE_KEY_LEN ||
    !parsedPaneKey ||
    typeof hookPayload !== 'object' ||
    hookPayload === null
  ) {
    return null
  }

  warnOnHookEnvOrVersionMismatch(state, {
    version: readStringField(record, 'version'),
    env: readStringField(record, 'env'),
    expectedEnv
  })

  const tabId = readStringField(record, 'tabId')
  if (tabId && tabId !== parsedPaneKey.tabId) {
    return null
  }
  const worktreeId = readStringField(record, 'worktreeId')
  const launchToken = readStringField(record, 'launchToken')

  const hookPayloadRecord = hookPayload as Record<string, unknown>
  const eventName =
    readFirstString(record, ['hook_event_name', 'hookEventName', 'hook_type', 'hookType']) ??
    hookPayloadRecord.hook_event_name ??
    hookPayloadRecord.hookEventName
  // Why: Codex child hooks expose the child's session_id on the parent's pane.
  const providerSession =
    source === 'codex' && readString(hookPayloadRecord, 'agent_id')
      ? null
      : extractAgentProviderSession(source, hookPayloadRecord)
  const providerPromptId =
    source === 'claude' ? normalizeClaudePromptId(hookPayloadRecord.prompt_id) : undefined
  const compactTrigger =
    source === 'claude' &&
    (eventName === 'PreCompact' || eventName === 'PostCompact') &&
    (hookPayloadRecord.trigger === 'manual' || hookPayloadRecord.trigger === 'auto')
      ? hookPayloadRecord.trigger
      : undefined
  const isCompactEvent = eventName === 'PreCompact' || eventName === 'PostCompact'
  if (isCompactEvent && compactTrigger === undefined) {
    return null
  }
  const previousStatus = state.lastStatusByPaneKey.get(paneKey)
  if (
    compactTrigger !== undefined &&
    !canAcceptClaudeCompactTransition(
      previousStatus,
      {
        source,
        connectionId: null,
        hookEventName: typeof eventName === 'string' ? eventName : undefined,
        providerPromptId,
        compactTrigger,
        providerSession: providerSession ?? undefined
      },
      {
        allowUnanchoredPreCompact: options.allowUnanchoredPreCompact,
        allowUnanchoredPostCompact: options.allowUnanchoredPostCompact
      }
    )
  ) {
    return null
  }
  if (
    eventName === 'PostCompact' &&
    compactTrigger !== undefined &&
    previousStatus?.payload.prompt &&
    !state.lastPromptByPaneKey.has(paneKey)
  ) {
    state.lastPromptByPaneKey.set(paneKey, previousStatus.payload.prompt)
  }
  const extractedPrompt = extractPromptText(hookPayload as Record<string, unknown>)
  const promptText = extractedPrompt.text
  // Why: exhaustive switch so a new AgentHookSource fails typecheck here instead of silently misrouting.
  let payload: ParsedAgentStatusPayload | null
  switch (source) {
    case 'claude':
      payload = normalizeClaudeEvent(state, eventName, promptText, paneKey, hookPayloadRecord)
      break
    case 'codex':
      payload = normalizeCodexEvent(state, eventName, promptText, paneKey, hookPayloadRecord)
      break
  }

  // Why: connectionId is null here; ingestRemote stamps it from mux identity on receive. See docs/design/agent-status-over-ssh.md §5.
  return payload
    ? {
        paneKey,
        source,
        launchToken,
        tabId,
        worktreeId,
        connectionId: null,
        hasExplicitPrompt: hasExplicitUserPrompt(source, eventName, extractedPrompt),
        hookEventName: typeof eventName === 'string' ? eventName : undefined,
        providerPromptId,
        compactTrigger,
        toolUseId: readFirstString(hookPayloadRecord, ['tool_use_id', 'toolUseId']),
        toolAgentId: readFirstString(hookPayloadRecord, ['agent_id', 'agentId']),
        toolAgentType: readString(hookPayloadRecord, 'agent_type'),
        ...(source === 'claude'
          ? {
              claudeRunningNonAgentTask:
                state.claudeRunningNonAgentTaskPaneKeys.has(paneKey) ||
                state.claudeActiveSessionCronPaneKeys.has(paneKey)
            }
          : {}),
        ...(providerSession ? { providerSession } : {}),
        payload
      }
    : null
}

// ─── URL routing ────────────────────────────────────────────────────

export const HOOK_SOURCE_BY_PATHNAME: Readonly<Record<string, AgentHookSource>> = Object.freeze({
  '/hook/claude': 'claude',
  '/hook/codex': 'codex'
})

export function resolveHookSource(pathname: string): AgentHookSource | null {
  return HOOK_SOURCE_BY_PATHNAME[pathname] ?? null
}

// ─── Endpoint-file writing ──────────────────────────────────────────

export function getEndpointFileName(): string {
  // Why: per-platform extension lets hook scripts source the file natively (POSIX `. "$file"` / Windows `call "%file%"`).
  return process.platform === 'win32' ? 'endpoint.cmd' : 'endpoint.env'
}

export function isShellSafeEndpointValue(value: string): boolean {
  // Why: values are shell-sourced; the + rejects empty strings so a sourced `KEY=` can't clear the env var.
  return /^[A-Za-z0-9._:/-]+$/.test(value)
}

export type EndpointFileFields = {
  port: number
  token: string
  env: string
  version: string
}

/** Atomically write the endpoint file at `endpointDir/<getEndpointFileName()>`.
 *  Returns true on success, false on error (caller may fall back to PTY env).
 *  Kept in sync with `AgentHookServer.writeEndpointFile`. */
export function writeEndpointFile(
  endpointDir: string,
  finalPath: string,
  fields: EndpointFileFields
): boolean {
  const tmpPath = join(endpointDir, `.endpoint-${process.pid}-${randomUUID()}.tmp`)
  const prefix = process.platform === 'win32' ? 'set ' : ''
  const valuesToWrite: [string, string][] = [
    ['ORCA_AGENT_HOOK_PORT', String(fields.port)],
    ['ORCA_AGENT_HOOK_TOKEN', fields.token],
    ['ORCA_AGENT_HOOK_ENV', fields.env],
    ['ORCA_AGENT_HOOK_VERSION', fields.version]
  ]
  for (const [key, value] of valuesToWrite) {
    if (!isShellSafeEndpointValue(value)) {
      console.error(
        `[agent-hooks] refusing to write endpoint file: ${key} contains ` +
          'characters unsafe for shell sourcing. Falling back to PTY env.'
      )
      return false
    }
  }
  const lines = [...valuesToWrite.map(([key, value]) => `${prefix}${key}=${value}`), '']
  let tmpWritten = false
  try {
    // Why: 0o700 owner-only so the dir doesn't leak this install's existence to other local users.
    mkdirSync(endpointDir, { recursive: true, mode: 0o700 })
    if (process.platform !== 'win32') {
      // Why: mkdirSync mode only applies on creation; chmod fixes perms on a pre-existing dir (POSIX-only).
      try {
        chmodSync(endpointDir, 0o700)
      } catch {
        // best-effort
      }
    }
    // Why: crash-orphan cleanup must not materialize a tampered, enormous directory.
    sweepStaleAgentHookEndpointTemps(endpointDir)
    const separator = process.platform === 'win32' ? '\r\n' : '\n'
    writeFileSync(tmpPath, lines.join(separator), { mode: 0o600 })
    tmpWritten = true
    renameSync(tmpPath, finalPath)
    return true
  } catch (err) {
    console.error('[agent-hooks] failed to write endpoint file:', err)
    if (tmpWritten) {
      try {
        unlinkSync(tmpPath)
      } catch {
        // tmp may already be gone
      }
    }
    return false
  }
}
