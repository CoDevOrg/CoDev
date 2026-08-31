// CoDev-only. Turns an agent CLI's file-writing tool call into a "this agent is
// editing this file, right now" beat that the embedded editor renders as live
// presence — a coloured cursor and label at the last line each agent touched.
//
// Upstream Orca has no equivalent: it shows agent *status* (working / waiting)
// but never surfaces which file an agent is mid-edit in. The signal already
// arrives — every managed agent hook POSTs `PostToolUse` with `tool_name` and
// `tool_input` (see `agent-hook-listener.ts`) — this module is the pure
// extraction step that the main-process hook server calls before forwarding the
// result to the renderer over IPC.
//
// Pure and dependency-light on purpose (no Electron, no React): it is unit
// tested in isolation and imported from both `src/main` and `src/renderer`.

import { agentKindSchema, type AgentKind } from './telemetry-events'

// Why: the write subset of `TOOL_INPUT_KEYS_BY_TOOL` in `agent-hook-listener.ts`,
// across every agent CLI Orca speaks to (Claude, Codex, Gemini, Grok, Cursor,
// OpenCode, Windsurf-style `*_file_content`, …). Read/search/shell tools are
// deliberately excluded — presence should track authorship, not navigation.
export const CODEV_FILE_WRITE_TOOLS: ReadonlySet<string> = new Set([
  'Write',
  'Create',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'write_file',
  'edit_file',
  'replace',
  'search_replace',
  'write_to_file',
  'apply_patch',
  'create',
  'write',
  'edit',
  'patch',
  'replace_file_content',
  'multi_replace_file_content',
])

// Why: ordered by specificity — `TargetFile` / `AbsolutePath` are Windsurf/Cursor
// spellings that co-exist with a generic `path`, so check them first.
const PATH_KEYS = [
  'file_path',
  'filePath',
  'TargetFile',
  'AbsolutePath',
  'path',
] as const

// Why: agents that report an edit location use one of these; pairs like
// `start_line`/`end_line` are read together, lone keys collapse to a caret.
const START_LINE_KEYS = [
  'start_line',
  'startLine',
  'StartLine',
  'line',
  'line_number',
  'lineNumber',
  'first_line',
] as const
const END_LINE_KEYS = ['end_line', 'endLine', 'EndLine', 'last_line'] as const

/** Aliases from a raw hook `agent_type` to the closed telemetry `AgentKind`. */
const AGENT_KIND_ALIASES: Record<string, AgentKind> = {
  claude: 'claude-code',
  'claude-code': 'claude-code',
  'claude code': 'claude-code',
  anthropic: 'claude-code',
  openai: 'codex',
  'gpt-5': 'codex',
}

export type CodevLiveEdit = {
  /** Durable `${tabId}:${leafUuid}` pane key of the agent's chat tab. */
  paneKey: string
  /** Worktree checkout the edit landed in. Presence is scoped per worktree. */
  worktreeId: string
  agentKind: AgentKind
  /** Worktree-relative POSIX path of the edited file. */
  filePath: string
  /** 1-based inclusive line range, when the tool input reveals one; else null. */
  startLine: number | null
  endLine: number | null
  /** The file-writing tool that produced the edit (`Edit`, `write_file`, …). */
  tool: string
  /** Wall-clock ms the edit was observed in the IDE main process. */
  at: number
}

export type CodevLiveEditSource = {
  paneKey: string | null | undefined
  worktreeId: string | null | undefined
  /** Raw `agent_type` from the hook payload, or a resolved `AgentKind`. */
  agentKind: string | null | undefined
  toolName: string | null | undefined
  /** Parsed `tool_input`: an object, a JSON string, or a bare path string. */
  toolInput: unknown
  /** Absolute worktree root, used to relativise an absolute `file_path`. */
  worktreeRoot?: string | null
  /** Overridable clock for tests. Defaults to `Date.now()`. */
  now?: number
}

export function isCodevFileWriteTool(toolName: string | null | undefined): boolean {
  return typeof toolName === 'string' && CODEV_FILE_WRITE_TOOLS.has(toolName)
}

export function normalizeCodevAgentKind(value: string | null | undefined): AgentKind {
  const raw = value?.trim()
  if (!raw) {
    return 'other'
  }
  const lowered = raw.toLowerCase()
  if (lowered in AGENT_KIND_ALIASES) {
    return AGENT_KIND_ALIASES[lowered]!
  }
  const parsed = agentKindSchema.safeParse(lowered)
  return parsed.success ? parsed.data : 'other'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('{')) {
      try {
        const parsed: unknown = JSON.parse(trimmed)
        return typeof parsed === 'object' && parsed !== null
          ? (parsed as Record<string, unknown>)
          : null
      } catch {
        return null
      }
    }
    return null
  }
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim()
    }
  }
  return null
}

function firstPositiveInt(
  record: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const candidate = record[key]
    const numeric =
      typeof candidate === 'number'
        ? candidate
        : typeof candidate === 'string' && candidate.trim() !== ''
          ? Number(candidate)
          : Number.NaN
    if (Number.isInteger(numeric) && numeric > 0) {
      return numeric
    }
  }
  return null
}

/**
 * Normalise a raw file path from a tool call into a worktree-relative POSIX
 * path, or return null if it escapes the worktree (absolute path outside the
 * root, or any `..` segment). The renderer keys presence by this path, so a
 * value that cannot be trusted to sit inside the checkout is dropped entirely.
 */
export function normalizeWorktreeRelativePath(
  rawPath: string,
  worktreeRoot?: string | null,
): string | null {
  let path = rawPath.replace(/\\/g, '/').trim()
  if (path.length === 0) {
    return null
  }

  const root = worktreeRoot?.replace(/\\/g, '/').replace(/\/+$/, '').trim()
  if (root && (path === root || path.startsWith(`${root}/`))) {
    path = path.slice(root.length).replace(/^\/+/, '')
  }

  // A still-absolute path (no root given, or a different root) cannot be placed
  // in the tree; a `~` home path is equally unusable.
  if (path.startsWith('/') || path.startsWith('~')) {
    return null
  }
  if (/^[A-Za-z]:\//.test(path)) {
    return null
  }

  path = path.replace(/^\.\/+/, '')
  const segments = path.split('/').filter((segment) => segment !== '' && segment !== '.')
  if (segments.length === 0) {
    return null
  }
  if (segments.some((segment) => segment === '..')) {
    return null
  }

  return segments.join('/')
}

/**
 * Derive a `CodevLiveEdit` from one `PostToolUse` hook observation, or null when
 * it is not a file write we can place: a non-write tool, a missing worktree, or
 * a path that escapes the checkout.
 */
export function deriveCodevLiveEdit(source: CodevLiveEditSource): CodevLiveEdit | null {
  const paneKey = source.paneKey?.trim()
  const worktreeId = source.worktreeId?.trim()
  const tool = source.toolName?.trim()
  if (!paneKey || !worktreeId || !tool) {
    return null
  }
  if (!CODEV_FILE_WRITE_TOOLS.has(tool)) {
    return null
  }

  const record = asRecord(source.toolInput)
  const rawPath =
    record !== null
      ? firstString(record, PATH_KEYS)
      : typeof source.toolInput === 'string' && source.toolInput.trim().length > 0
        ? source.toolInput.trim()
        : null
  if (!rawPath) {
    return null
  }

  const filePath = normalizeWorktreeRelativePath(rawPath, source.worktreeRoot)
  if (!filePath) {
    return null
  }

  let startLine: number | null = null
  let endLine: number | null = null
  if (record !== null) {
    startLine = firstPositiveInt(record, START_LINE_KEYS)
    endLine = firstPositiveInt(record, END_LINE_KEYS)
    // Why: `offset` + `limit` (Read-style windowing some agents reuse for edits)
    // gives a range when explicit line keys are absent.
    if (startLine === null) {
      const offset = firstPositiveInt(record, ['offset'])
      const limit = firstPositiveInt(record, ['limit'])
      if (offset !== null) {
        startLine = offset
        if (limit !== null) {
          endLine = offset + limit - 1
        }
      }
    }
    if (startLine !== null && (endLine === null || endLine < startLine)) {
      endLine = startLine
    }
  }

  return {
    paneKey,
    worktreeId,
    agentKind: normalizeCodevAgentKind(source.agentKind),
    filePath,
    startLine,
    endLine,
    tool,
    at: source.now ?? Date.now(),
  }
}
