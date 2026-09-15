/* eslint-disable max-lines -- Why: this fixture keeps cross-agent hook normalization and cache behavior together so regressions in shared listener state are visible. */
import { EventEmitter } from 'node:events'
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearClaudeAnsweredQuestionWait,
  clearPaneCacheState,
  createHookListenerState,
  getEndpointFileName,
  markClaudeLeadTurnInterrupted,
  seedClaudeSubagentRosterFromSnapshots,
  HOOK_REQUEST_MAX_BYTES,
  isShellSafeEndpointValue,
  normalizeHookPayload,
  parseFormEncodedBody,
  readRequestBody,
  resolveHookSource,
  writeEndpointFile,
  type HookListenerState
} from './agent-hook-listener'
import { AGENT_STATUS_MAX_SUBAGENTS } from './agent-status-types'
import { makePaneKey } from './stable-pane-id'

const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const PANE_KEY = makePaneKey('tab-1', LEAF_ID)
const CLAUDE_PROMPT_ID = '22222222-2222-4222-8222-222222222222'
const CLAUDE_PREVIOUS_PROMPT_ID = '33333333-3333-4333-8333-333333333333'

function normalizeAndAccept(
  state: HookListenerState,
  source: Parameters<typeof normalizeHookPayload>[1],
  payload: Record<string, unknown>
): ReturnType<typeof normalizeHookPayload> {
  const event = normalizeHookPayload(state, source, { paneKey: PANE_KEY, payload }, 'production')
  if (event) {
    state.lastStatusByPaneKey.set(PANE_KEY, event)
  }
  return event
}

type FakeIncomingMessage = EventEmitter & {
  headers: IncomingHttpHeaders
  destroy: ReturnType<typeof vi.fn>
}

function createReadableRequest(headers: IncomingHttpHeaders = {}): FakeIncomingMessage {
  const req = new EventEmitter() as FakeIncomingMessage
  req.headers = headers
  req.destroy = vi.fn(() => req.emit('close'))
  return req
}

function expectRequestParserListenersReleased(req: FakeIncomingMessage): void {
  expect(req.listenerCount('data')).toBe(0)
  expect(req.listenerCount('end')).toBe(0)
  expect(req.listenerCount('close')).toBe(0)
  expect(req.listenerCount('error')).toBe(1)
  expect(() => req.emit('error', new Error('late request error'))).not.toThrow()
}

describe('shared agent-hook-listener', () => {
  let state: HookListenerState

  beforeEach(() => {
    state = createHookListenerState()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('parses form-encoded bodies', () => {
    const decoded = parseFormEncodedBody('paneKey=tab-1%3A0&worktreeId=foo')
    expect(decoded.paneKey).toBe('tab-1:0')
    expect(decoded.worktreeId).toBe('foo')
  })

  it('releases request parser listeners after reading a JSON body', async () => {
    const req = createReadableRequest({ 'content-type': 'application/json' })
    const body = readRequestBody(req as unknown as IncomingMessage)

    req.emit('data', Buffer.from('{"ok":true}'))
    req.emit('end')

    await expect(body).resolves.toEqual({ ok: true })
    expectRequestParserListenersReleased(req)
  })

  it('releases request parser listeners after rejecting an oversized body', async () => {
    const req = createReadableRequest({ 'content-type': 'application/json' })
    const body = readRequestBody(req as unknown as IncomingMessage)

    req.emit('data', Buffer.alloc(HOOK_REQUEST_MAX_BYTES + 1))

    await expect(body).rejects.toThrow('payload too large')
    expect(req.destroy).toHaveBeenCalledTimes(1)
    expectRequestParserListenersReleased(req)
  })

  it('routes pathnames to a known source or null', () => {
    expect(resolveHookSource('/hook/claude')).toBe('claude')
    expect(resolveHookSource('/hook/codex')).toBe('codex')
    expect(resolveHookSource('/hook/unknown')).toBeNull()
    expect(resolveHookSource('/')).toBeNull()
  })

  it('rejects shell-unsafe endpoint values', () => {
    expect(isShellSafeEndpointValue('1234')).toBe(true)
    expect(isShellSafeEndpointValue('abc-DEF.0_1')).toBe(true)
    expect(isShellSafeEndpointValue('')).toBe(false)
    expect(isShellSafeEndpointValue('foo&bar')).toBe(false)
    expect(isShellSafeEndpointValue('foo bar')).toBe(false)
    expect(isShellSafeEndpointValue('foo;bar')).toBe(false)
  })

  it('normalizes a Claude UserPromptSubmit body to a working state', () => {
    const event = normalizeHookPayload(
      state,
      'claude',
      {
        paneKey: PANE_KEY,
        tabId: 'tab-1',
        worktreeId: 'wt',
        env: 'production',
        version: '1',
        payload: { hook_event_name: 'UserPromptSubmit', prompt: 'hello' }
      },
      'production'
    )
    expect(event).not.toBeNull()
    expect(event!.paneKey).toBe(PANE_KEY)
    expect(event!.connectionId).toBeNull()
    expect(event!.payload.state).toBe('working')
    expect(event!.payload.prompt).toBe('hello')
    expect(event!.payload.agentType).toBe('claude')
  })

  it('captures the full AskUserQuestion tool input as interactivePrompt (untruncated)', () => {
    const questions = {
      questions: Array.from({ length: 4 }, (_, i) => ({
        question: `Question ${i} ${'detail '.repeat(40)}`,
        options: ['option one', 'option two', 'option three']
      }))
    }
    const event = normalizeHookPayload(
      state,
      'claude',
      {
        paneKey: PANE_KEY,
        payload: {
          hook_event_name: 'PreToolUse',
          tool_name: 'AskUserQuestion',
          tool_input: questions
        }
      },
      'production'
    )

    expect(event?.payload.toolName).toBe('AskUserQuestion')
    // Why: the auto-allowed AskUserQuestion PreToolUse is a human-input boundary,
    // so it must read as waiting (amber attention) rather than a working spinner.
    expect(event?.payload.state).toBe('waiting')
    const expected = JSON.stringify(questions)
    expect(event?.payload.interactivePrompt).toBe(expected)
    // Why: must NOT be truncated to the 160-char toolInput preview cap.
    expect(expected.length).toBeGreaterThan(200)
    expect(event?.payload.interactivePrompt!.length).toBe(expected.length)
  })

  it('maps Claude AskUserQuestion PreToolUse to waiting, then back to working on answer', () => {
    const question = normalizeHookPayload(
      state,
      'claude',
      {
        paneKey: PANE_KEY,
        payload: {
          hook_event_name: 'PreToolUse',
          tool_name: 'AskUserQuestion',
          tool_input: { questions: [{ question: 'Pick', options: ['a', 'b'] }] }
        }
      },
      'production'
    )
    const answered = normalizeHookPayload(
      state,
      'claude',
      {
        paneKey: PANE_KEY,
        payload: {
          hook_event_name: 'PostToolUse',
          tool_name: 'AskUserQuestion',
          tool_response: { selected: ['a'] }
        }
      },
      'production'
    )

    expect(question?.payload).toMatchObject({
      agentType: 'claude',
      state: 'waiting',
      toolName: 'AskUserQuestion'
    })
    expect(answered?.payload).toMatchObject({
      agentType: 'claude',
      state: 'working',
      toolName: 'AskUserQuestion'
    })
  })

  it('keeps a normal Claude PreToolUse tool call as working', () => {
    const event = normalizeHookPayload(
      state,
      'claude',
      {
        paneKey: PANE_KEY,
        payload: {
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_input: { command: 'ls' }
        }
      },
      'production'
    )
    expect(event?.payload.state).toBe('working')
    expect(event?.payload.toolName).toBe('Bash')
  })

  it('leaves interactivePrompt undefined for a normal tool call', () => {
    const event = normalizeHookPayload(
      state,
      'claude',
      {
        paneKey: PANE_KEY,
        payload: {
          hook_event_name: 'PreToolUse',
          tool_name: 'Edit',
          tool_input: { file_path: '/tmp/x.ts' }
        }
      },
      'production'
    )
    expect(event?.payload.toolName).toBe('Edit')
    expect(event?.payload.interactivePrompt).toBeUndefined()
  })

  it('captures an approval envelope as interactivePrompt on a PermissionRequest', () => {
    const event = normalizeHookPayload(
      state,
      'claude',
      {
        paneKey: PANE_KEY,
        payload: {
          hook_event_name: 'PermissionRequest',
          tool_name: 'Bash',
          tool_input: { command: 'rm -rf build' }
        }
      },
      'production'
    )
    expect(event?.payload.interactivePrompt).toBe(
      JSON.stringify({ approval: { tool: 'Bash', summary: 'rm -rf build' } })
    )
  })

  it('captures an approval envelope for a Codex PermissionRequest', () => {
    const event = normalizeHookPayload(
      state,
      'codex',
      {
        paneKey: PANE_KEY,
        payload: {
          hook_event_name: 'PermissionRequest',
          tool_name: 'shell',
          input: { command: 'git push --force' }
        }
      },
      'production'
    )
    expect(event?.payload.interactivePrompt).toBe(
      JSON.stringify({ approval: { tool: 'shell', summary: 'git push --force' } })
    )
  })

  it('clears interactivePrompt on the next tool event after AskUserQuestion', () => {
    normalizeHookPayload(
      state,
      'claude',
      {
        paneKey: PANE_KEY,
        payload: {
          hook_event_name: 'PreToolUse',
          tool_name: 'AskUserQuestion',
          tool_input: { questions: [{ question: 'Pick', options: ['a'] }] }
        }
      },
      'production'
    )
    const next = normalizeHookPayload(
      state,
      'claude',
      {
        paneKey: PANE_KEY,
        payload: {
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_input: { command: 'ls' }
        }
      },
      'production'
    )
    expect(next?.payload.toolName).toBe('Bash')
    expect(next?.payload.toolInput).toBe('ls')
    expect(next?.payload.interactivePrompt).toBeUndefined()
  })

  it('does not re-assert the AskUserQuestion prompt on PostToolUse', () => {
    // The question was answered, so PostToolUse must clear the live card instead
    // of re-deriving the `{questions}` prompt from the carried tool input.
    const event = normalizeHookPayload(
      state,
      'claude',
      {
        paneKey: PANE_KEY,
        payload: {
          hook_event_name: 'PostToolUse',
          tool_name: 'AskUserQuestion',
          tool_input: { questions: [{ question: 'Pick', options: ['a'] }] }
        }
      },
      'production'
    )
    expect(event?.payload.toolName).toBe('AskUserQuestion')
    expect(event?.payload.interactivePrompt).toBeUndefined()
  })

  it('reads the last assistant message behind an oversized line without quadratic copying', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'orca-assistant-huge-line-'))
    const transcriptPath = join(tmpDir, 'transcript.jsonl')
    const originalConcat = Buffer.concat
    let concatenatedBytes = 0
    try {
      // The shared backward reader (readLastTextFromTranscriptOnce) stitches a
      // line spanning many read blocks. Re-joining the carry per block copies
      // O(line^2); the chunk list defers to one join.
      const lineBytes = 2 * 1024 * 1024
      writeFileSync(
        transcriptPath,
        `${JSON.stringify({
          role: 'assistant',
          content: [{ type: 'text', text: 'answer behind a huge line' }]
        })}\n${JSON.stringify({
          role: 'user',
          content: [{ type: 'text', text: 'x'.repeat(lineBytes) }]
        })}\n`
      )

      Buffer.concat = ((list: readonly Uint8Array[], totalLength?: number) => {
        const joined = originalConcat(list as Uint8Array[], totalLength)
        concatenatedBytes += joined.length
        return joined
      }) as typeof Buffer.concat

      const done = normalizeHookPayload(
        state,
        'claude',
        {
          paneKey: PANE_KEY,
          tabId: 'tab-1',
          worktreeId: 'wt',
          env: 'production',
          version: '1',
          payload: { hook_event_name: 'Stop', transcript_path: transcriptPath }
        },
        'production'
      )

      expect(done?.payload.lastAssistantMessage).toBe('answer behind a huge line')
      // Linear copies once (~lineBytes); the quadratic form copied many times that.
      expect(concatenatedBytes).toBeLessThan(lineBytes * 4)
    } finally {
      Buffer.concat = originalConcat
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  // Why these three: the prompt read scans backward from EOF and stops at the
  // first user line, so the cases that can break are a prompt spanning a chunk
  // boundary, a later prompt that must win over an earlier one, and the byte
  // offset in interactionKey, which the old forward pass computed absolutely.
  it('trims surrounding whitespace from extracted prompt text', () => {
    const event = normalizeHookPayload(
      state,
      'claude',
      {
        paneKey: PANE_KEY,
        payload: { hook_event_name: 'UserPromptSubmit', prompt: '   hi   ' }
      },
      'production'
    )
    expect(event).not.toBeNull()
    expect(event!.payload.prompt).toBe('hi')
  })

  it('normalizes a Claude-compatible StopFailure to done without copying provider error text', () => {
    normalizeHookPayload(
      state,
      'claude',
      {
        paneKey: PANE_KEY,
        payload: { hook_event_name: 'UserPromptSubmit', prompt: 'say hi' }
      },
      'production'
    )

    const event = normalizeHookPayload(
      state,
      'claude',
      {
        paneKey: PANE_KEY,
        payload: {
          hook_event_name: 'StopFailure',
          error: 'invalid_request',
          error_details: 'model is not supported',
          last_assistant_message: 'API Error: model is not supported'
        }
      },
      'production'
    )

    expect(event?.payload).toMatchObject({
      state: 'done',
      prompt: 'say hi',
      agentType: 'claude'
    })
    expect(event?.payload.lastAssistantMessage).toBeUndefined()
  })

  it('maps Claude SessionStart to an idle done row so a resumed session earns its sidebar row before the first prompt', () => {
    const event = normalizeHookPayload(
      state,
      'claude',
      {
        paneKey: PANE_KEY,
        payload: {
          hook_event_name: 'SessionStart',
          source: 'resume',
          session_id: '44444444-4444-4444-8444-444444444444'
        }
      },
      'production'
    )

    // Why: 'working' would show a phantom spinner on an idle TUI; a session-boundary
    // 'done' renders the row idle, which is the truth at SessionStart.
    expect(event?.payload).toMatchObject({
      state: 'done',
      prompt: '',
      agentType: 'claude',
      sessionBoundary: true
    })
    expect(event?.payload.interrupted).toBeUndefined()
    expect(event?.hookEventName).toBe('SessionStart')
    // Why: SessionStart carries resume identity, so in-app resume works before any prompt.
    expect(event?.providerSession).toMatchObject({
      key: 'session_id',
      id: '44444444-4444-4444-8444-444444444444'
    })
  })

  it('resets stale Claude turn state when SessionStart announces a new session on the pane', () => {
    normalizeAndAccept(state, 'claude', { hook_event_name: 'UserPromptSubmit', prompt: 'fix bug' })
    normalizeAndAccept(state, 'claude', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' }
    })
    normalizeAndAccept(state, 'claude', { hook_event_name: 'SubagentStart', agent_id: 'agent-1' })

    const event = normalizeAndAccept(state, 'claude', {
      hook_event_name: 'SessionStart',
      source: 'startup'
    })

    // Why: a new process owns the pane; stale prompt/tool/children must not survive
    // into the fresh session's idle row or gate it back up to 'working'.
    expect(event?.payload.state).toBe('done')
    expect(event?.payload.prompt).toBe('')
    expect(event?.payload.toolName).toBeUndefined()
    expect(event?.payload.subagents).toBeUndefined()
  })

  it('keeps the running Claude turn when SessionStart comes from a compact restart or a child session', () => {
    normalizeAndAccept(state, 'claude', { hook_event_name: 'UserPromptSubmit', prompt: 'say hi' })

    const compacted = normalizeHookPayload(
      state,
      'claude',
      { paneKey: PANE_KEY, payload: { hook_event_name: 'SessionStart', source: 'compact' } },
      'production'
    )
    // Why: unknown/missing sources fail closed — only startup/resume/clear are idle boundaries.
    const unknownSource = normalizeHookPayload(
      state,
      'claude',
      { paneKey: PANE_KEY, payload: { hook_event_name: 'SessionStart' } },
      'production'
    )
    const child = normalizeHookPayload(
      state,
      'claude',
      {
        paneKey: PANE_KEY,
        payload: { hook_event_name: 'SessionStart', source: 'startup', agent_id: 'agent-7' }
      },
      'production'
    )
    const stopped = normalizeAndAccept(state, 'claude', { hook_event_name: 'Stop' })

    // Why: auto-compact restarts mid-turn (PreCompact/PostCompact own that lifecycle) and a
    // child-attributed SessionStart must not flip the lead's live turn to an idle row.
    expect(compacted).toBeNull()
    expect(unknownSource).toBeNull()
    expect(child).toBeNull()
    expect(stopped?.payload).toMatchObject({ state: 'done', prompt: 'say hi' })
    expect(stopped?.payload.sessionBoundary).toBeUndefined()
  })

  // Why: Kimi shares Claude-compatible compact/harness hooks; cover the same sticky-working
  // guards so a Kimi-only regression cannot slip past the Claude-only tests (issue #11352).
  it('rejects oversized paneKey', () => {
    const event = normalizeHookPayload(
      state,
      'claude',
      {
        paneKey: 'x'.repeat(300),
        payload: { hook_event_name: 'UserPromptSubmit', prompt: 'hi' }
      },
      'production'
    )
    expect(event).toBeNull()
  })

  it('resumes work for task notifications without replacing the cached prompt', () => {
    normalizeHookPayload(
      state,
      'claude',
      { paneKey: PANE_KEY, payload: { hook_event_name: 'UserPromptSubmit', prompt: 'fix login' } },
      'production'
    )
    const event = normalizeHookPayload(
      state,
      'claude',
      {
        paneKey: PANE_KEY,
        payload: {
          hook_event_name: 'UserPromptSubmit',
          prompt: '<task-notification> <task-id>bzthj2b8r</task-id> <tool-use-id>t1</tool-use-id>'
        }
      },
      'production'
    )
    expect(event).not.toBeNull()
    expect(event!.payload.state).toBe('working')
    expect(event!.payload.prompt).toBe('fix login')
    expect(event!.hasExplicitPrompt).toBe(false)
  })

  it('emits a harness-injected UserPromptSubmit with an empty uncached prompt', () => {
    const event = normalizeHookPayload(
      state,
      'claude',
      {
        paneKey: PANE_KEY,
        payload: {
          hook_event_name: 'UserPromptSubmit',
          prompt: '<system-reminder>background context</system-reminder>'
        }
      },
      'production'
    )
    expect(event).not.toBeNull()
    expect(event!.payload.state).toBe('working')
    expect(event!.payload.prompt).toBe('')
    expect(event!.hasExplicitPrompt).toBe(false)
  })

  it('does not leave working after a compact-summary UserPromptSubmit (issue #11352)', () => {
    // Live repro: after /compact Claude injects "This session is being continued…" with no Stop.
    const event = normalizeHookPayload(
      state,
      'claude',
      {
        paneKey: PANE_KEY,
        payload: {
          hook_event_name: 'UserPromptSubmit',
          prompt:
            'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.'
        }
      },
      'production'
    )
    expect(event).toBeNull()
  })

  it('maps an identity-matched Claude manual compact lifecycle', () => {
    normalizeAndAccept(state, 'claude', {
      hook_event_name: 'UserPromptSubmit',
      prompt: 'work before compact',
      prompt_id: CLAUDE_PREVIOUS_PROMPT_ID,
      session_id: 'session-a'
    })
    const pre = normalizeAndAccept(state, 'claude', {
      hook_event_name: 'PreCompact',
      trigger: 'manual',
      prompt_id: CLAUDE_PROMPT_ID,
      session_id: 'session-a'
    })
    expect(pre).not.toBeNull()
    expect(pre!.payload.state).toBe('working')
    expect(pre!.payload.agentType).toBe('claude')

    const post = normalizeAndAccept(state, 'claude', {
      hook_event_name: 'PostCompact',
      trigger: 'manual',
      prompt_id: CLAUDE_PROMPT_ID,
      session_id: 'session-a'
    })
    expect(post).not.toBeNull()
    expect(post!.payload.state).toBe('done')
    expect(post!.payload.agentType).toBe('claude')
  })

  it('keeps the preceding user prompt on the completed compact row', () => {
    normalizeAndAccept(state, 'claude', {
      hook_event_name: 'UserPromptSubmit',
      prompt: 'work before compact',
      prompt_id: CLAUDE_PREVIOUS_PROMPT_ID,
      session_id: 'session-a'
    })
    normalizeAndAccept(state, 'claude', {
      hook_event_name: 'PreCompact',
      trigger: 'manual',
      prompt_id: CLAUDE_PROMPT_ID,
      session_id: 'session-a'
    })
    const post = normalizeAndAccept(state, 'claude', {
      hook_event_name: 'PostCompact',
      trigger: 'manual',
      prompt_id: CLAUDE_PROMPT_ID,
      session_id: 'session-a'
    })
    expect(post).not.toBeNull()
    expect(post!.payload.state).toBe('done')
    expect(post!.payload.prompt).toBe('work before compact')
  })

  it('treats a custom-element paste as an explicit user turn, not machinery', () => {
    normalizeHookPayload(
      state,
      'claude',
      { paneKey: PANE_KEY, payload: { hook_event_name: 'UserPromptSubmit', prompt: 'fix login' } },
      'production'
    )
    // Why: a real prompt starting with an unknown kebab tag (<my-custom-element>)
    // is the user's turn — it must reset the cached prompt and count as explicit,
    // so interrupt recovery does not leave the pane visibly done.
    const event = normalizeHookPayload(
      state,
      'claude',
      {
        paneKey: PANE_KEY,
        payload: {
          hook_event_name: 'UserPromptSubmit',
          prompt: '<my-custom-element> render this component'
        }
      },
      'production'
    )
    expect(event).not.toBeNull()
    expect(event!.payload.prompt).toBe('<my-custom-element> render this component')
    expect(event!.hasExplicitPrompt).toBe(true)
  })

  it('isolates caches between listener instances', () => {
    const a = createHookListenerState()
    const b = createHookListenerState()
    normalizeHookPayload(
      a,
      'claude',
      { paneKey: PANE_KEY, payload: { hook_event_name: 'UserPromptSubmit', prompt: 'first' } },
      'production'
    )
    // The second listener has no cached prompt for this paneKey, so a tool
    // event without a fresh prompt should produce empty prompt string.
    const event = normalizeHookPayload(
      b,
      'claude',
      {
        paneKey: PANE_KEY,
        payload: {
          hook_event_name: 'PreToolUse',
          tool_name: 'Read',
          tool_input: { file_path: '/etc/hosts' }
        }
      },
      'production'
    )
    expect(event).not.toBeNull()
    expect(event!.payload.prompt).toBe('')
  })

  it('clears stale Codex tool input when a same-tool update has explicit unpreviewable input', () => {
    normalizeHookPayload(
      state,
      'codex',
      {
        paneKey: PANE_KEY,
        payload: {
          hook_event_name: 'PreToolUse',
          tool_name: 'BespokeTool',
          tool_input: 'old preview'
        }
      },
      'production'
    )

    const next = normalizeHookPayload(
      state,
      'codex',
      {
        paneKey: PANE_KEY,
        payload: {
          hook_event_name: 'PermissionRequest',
          tool_name: 'BespokeTool',
          tool_input: { request_id: 'approval-1' }
        }
      },
      'production'
    )

    expect(next?.payload.toolName).toBe('BespokeTool')
    expect(next?.payload.toolInput).toBeUndefined()
  })

  it('maps Codex request_user_input PreToolUse to waiting with the question card, then clears on the answer', () => {
    // Real Codex 0.145 shapes: PreToolUse fires while blocked on the answer (no Stop),
    // PostToolUse carries the answers, Stop ends the turn.
    const questions = {
      questions: [
        {
          id: 'color_preference',
          header: 'Color',
          question: 'Which color do you prefer: red or blue?',
          options: [{ label: 'Blue', description: 'Choose blue.' }]
        }
      ]
    }
    const waiting = normalizeHookPayload(
      state,
      'codex',
      {
        paneKey: PANE_KEY,
        payload: {
          hook_event_name: 'PreToolUse',
          tool_name: 'request_user_input',
          tool_input: questions,
          tool_use_id: 'call_1'
        }
      },
      'production'
    )
    expect(waiting?.payload.state).toBe('waiting')
    expect(waiting?.payload.toolName).toBe('request_user_input')
    expect(waiting?.payload.interactivePrompt).toBe(JSON.stringify(questions))

    const answered = normalizeHookPayload(
      state,
      'codex',
      {
        paneKey: PANE_KEY,
        payload: {
          hook_event_name: 'PostToolUse',
          tool_name: 'request_user_input',
          tool_input: questions,
          tool_response: '{"answers":{"color_preference":{"answers":["Blue"]}}}',
          tool_use_id: 'call_1'
        }
      },
      'production'
    )
    expect(answered?.payload.state).toBe('working')
    expect(answered?.payload.interactivePrompt).toBeUndefined()

    const stop = normalizeHookPayload(
      state,
      'codex',
      { paneKey: PANE_KEY, payload: { hook_event_name: 'Stop' } },
      'production'
    )
    expect(stop?.payload.state).toBe('done')
  })

  it('keeps ordinary Codex PreToolUse mapped to working', () => {
    const working = normalizeHookPayload(
      state,
      'codex',
      {
        paneKey: PANE_KEY,
        payload: {
          hook_event_name: 'PreToolUse',
          tool_name: 'shell',
          tool_input: { command: 'ls' }
        }
      },
      'production'
    )
    expect(working?.payload.state).toBe('working')
    expect(working?.payload.interactivePrompt).toBeUndefined()
  })

  describe('claude subagent tracking', () => {
    const claudeEvent = (
      payload: Record<string, unknown>,
      paneKey: string = PANE_KEY
    ): ReturnType<typeof normalizeHookPayload> =>
      normalizeHookPayload(state, 'claude', { paneKey, payload }, 'production')

    it('keeps Stop as done when background_tasks is empty', () => {
      claudeEvent({ hook_event_name: 'UserPromptSubmit', prompt: 'ship it' })
      const stop = claudeEvent({ hook_event_name: 'Stop', background_tasks: [] })
      expect(stop?.payload.state).toBe('done')
      expect(stop?.payload.subagents).toBeUndefined()
    })

    it.each([
      {
        label: 'a running shell task',
        eventName: 'Stop',
        payload: { background_tasks: [{ id: 'shell-1', type: 'shell', status: 'running' }] }
      },
      {
        label: 'a pending session cron',
        eventName: 'StopFailure',
        payload: { session_crons: [{ id: 'cron-1' }] }
      }
    ])(
      'reports Stop as working for $label without adding a subagent row',
      ({ eventName, payload }) => {
        claudeEvent({ hook_event_name: 'UserPromptSubmit', prompt: 'run in background' })
        const stop = claudeEvent({ hook_event_name: eventName, ...payload })
        expect(stop?.payload.state).toBe('working')
        expect(stop?.payload.subagents).toBeUndefined()
      }
    )

    it('reports Stop as working while a background subagent is still running', () => {
      claudeEvent({ hook_event_name: 'UserPromptSubmit', prompt: 'review the PR' })
      claudeEvent({
        hook_event_name: 'SubagentStart',
        agent_id: 'a1',
        agent_type: 'general-purpose'
      })
      const stop = claudeEvent({
        hook_event_name: 'Stop',
        background_tasks: [
          {
            id: 'a1',
            type: 'subagent',
            status: 'running',
            description: 'Review loop',
            agent_type: 'general-purpose'
          }
        ]
      })
      expect(stop?.payload.state).toBe('working')
      expect(stop?.payload.subagents).toEqual([
        {
          id: 'a1',
          state: 'working',
          startedAt: expect.any(Number),
          agentType: 'general-purpose',
          description: 'Review loop'
        }
      ])

      // Why: the child finishing wakes the lead; its final Stop reports an
      // empty roster and the pane resolves to done with no child rows left.
      claudeEvent({ hook_event_name: 'SubagentStop', agent_id: 'a1' })
      const finalStop = claudeEvent({ hook_event_name: 'Stop', background_tasks: [] })
      expect(finalStop?.payload.state).toBe('done')
      expect(finalStop?.payload.subagents).toBeUndefined()
    })

    it('emits a status refresh with the lead state on subagent lifecycle events', () => {
      claudeEvent({ hook_event_name: 'UserPromptSubmit', prompt: 'kick off reviewers' })
      claudeEvent({ hook_event_name: 'Stop', background_tasks: [] })

      const spawned = claudeEvent({
        hook_event_name: 'SubagentStart',
        agent_id: 'r1',
        agent_type: 'code-reviewer'
      })
      // Why: lead already stopped, but a live child means the pane is working.
      expect(spawned?.payload.state).toBe('working')
      expect(spawned?.payload.prompt).toBe('kick off reviewers')
      expect(spawned?.payload.subagents).toEqual([
        {
          id: 'r1',
          state: 'working',
          startedAt: expect.any(Number),
          agentType: 'code-reviewer',
          description: undefined
        }
      ])

      const stopped = claudeEvent({ hook_event_name: 'SubagentStop', agent_id: 'r1' })
      expect(stopped?.payload.state).toBe('done')
      // Why: a finished one-shot leaves the sidebar instead of squatting as a
      // permanent idle row for the rest of the session.
      expect(stopped?.payload.subagents).toBeUndefined()
    })

    it('keeps gating on tracked children when background_tasks is absent (older Claude)', () => {
      claudeEvent({
        hook_event_name: 'SubagentStart',
        agent_id: 'a1',
        agent_type: 'general-purpose'
      })
      const stop = claudeEvent({ hook_event_name: 'Stop' })
      expect(stop?.payload.state).toBe('working')
      expect(stop?.payload.subagents).toEqual([expect.objectContaining({ id: 'a1' })])
    })

    it('marks subagent-origin tool events as child activity without adopting them as lead state', () => {
      claudeEvent({ hook_event_name: 'UserPromptSubmit', prompt: 'go' })
      claudeEvent({ hook_event_name: 'Stop', background_tasks: [] })

      // Why: hook events from inside a subagent carry agent_id; they must keep
      // the child row live but not overwrite what the lead was last doing.
      const childTool = claudeEvent({
        hook_event_name: 'PreToolUse',
        agent_id: 'a9',
        agent_type: 'general-purpose',
        tool_name: 'Bash',
        tool_input: { command: 'pnpm test' }
      })
      expect(childTool?.payload.state).toBe('working')
      expect(childTool?.payload.subagents).toEqual([
        expect.objectContaining({ id: 'a9', state: 'working' })
      ])

      const stopped = claudeEvent({ hook_event_name: 'SubagentStop', agent_id: 'a9' })
      // Why: the lead's own last state was done, so with no working children
      // the pane settles back to done rather than a phantom working spinner.
      expect(stopped?.payload.state).toBe('done')
    })

    it('parks a teammate as a persistent idle row across its stop/idle/lead-Stop cycle', () => {
      // Why: the interactive agent-teams shape observed live on 2.1.217 —
      // lifecycle events use `a<name>-<hex>` agent ids while background_tasks
      // uses unrelated `type: "teammate"` task ids. SubagentStop + TeammateIdle
      // fire at every TURN end while the teammate stays alive awaiting mail,
      // so the row must park idle and survive lead Stops, not vanish.
      claudeEvent({ hook_event_name: 'UserPromptSubmit', prompt: 'spawn probe' })
      claudeEvent({
        hook_event_name: 'SubagentStart',
        agent_id: 'aprobe1-6d3cb5b52120b7bf',
        agent_type: 'probe1'
      })
      const teammateTask = {
        id: 'tlkjjs0jv',
        type: 'teammate',
        status: 'running',
        description: 'Run the shell command: sleep 25.'
      }
      const spawnStop = claudeEvent({
        hook_event_name: 'Stop',
        background_tasks: [teammateTask]
      })
      expect(spawnStop?.payload.state).toBe('working')
      expect(spawnStop?.payload.subagents).toEqual([
        expect.objectContaining({ id: 'aprobe1-6d3cb5b52120b7bf', state: 'working' })
      ])

      // Turn boundary: the row parks idle instead of leaving the sidebar.
      const stopped = claudeEvent({
        hook_event_name: 'SubagentStop',
        agent_id: 'aprobe1-6d3cb5b52120b7bf',
        agent_type: 'probe1',
        background_tasks: [teammateTask]
      })
      expect(stopped?.payload.subagents).toEqual([
        expect.objectContaining({ id: 'aprobe1-6d3cb5b52120b7bf', state: 'idle' })
      ])

      claudeEvent({
        hook_event_name: 'TeammateIdle',
        teammate_name: 'probe1',
        team_name: 'session-56c87269'
      })

      // The confirmed idle row survives the lead Stop (its teammate task is
      // still listed) without pinning the pane working.
      const wakeStop = claudeEvent({
        hook_event_name: 'Stop',
        background_tasks: [teammateTask]
      })
      expect(wakeStop?.payload.state).toBe('done')
      expect(wakeStop?.payload.subagents).toEqual([
        expect.objectContaining({ id: 'aprobe1-6d3cb5b52120b7bf', state: 'idle' })
      ])
    })

    it('parks a working teammate via TeammateIdle when its id prefix matches the name', () => {
      claudeEvent({ hook_event_name: 'UserPromptSubmit', prompt: 'spawn reviewer' })
      claudeEvent({
        hook_event_name: 'SubagentStart',
        agent_id: 'areviewer-6d3cb5b52120b7bf',
        agent_type: 'security-reviewer'
      })
      // Lead turn ends while the teammate works; pane stays working.
      const stop = claudeEvent({
        hook_event_name: 'Stop',
        background_tasks: [{ id: 'trev', type: 'teammate', status: 'running' }]
      })
      expect(stop?.payload.state).toBe('working')

      // Why: teammate name and agent type are separate Agent-tool inputs; the
      // lifecycle id embeds the former while the hook reports the latter.
      // TeammateIdle keyed by name parks it via the id prefix (fallback when
      // its SubagentStop was lost), so the pane settles back to the lead's
      // done state while the row stays visible as idle.
      const idled = claudeEvent({
        hook_event_name: 'TeammateIdle',
        teammate_name: 'reviewer',
        team_name: 'session-x'
      })
      expect(idled?.payload.subagents).toEqual([
        expect.objectContaining({ id: 'areviewer-6d3cb5b52120b7bf', state: 'idle' })
      ])
      expect(idled?.payload.state).toBe('done')
    })

    it('scopes subagent rosters per pane', () => {
      claudeEvent(
        { hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'general-purpose' },
        PANE_KEY
      )
      const otherPane = makePaneKey('tab-2', '22222222-2222-4222-8222-222222222222')
      claudeEvent({ hook_event_name: 'UserPromptSubmit', prompt: 'other' }, otherPane)
      const otherStop = claudeEvent({ hook_event_name: 'Stop', background_tasks: [] }, otherPane)
      expect(otherStop?.payload.state).toBe('done')
      expect(otherStop?.payload.subagents).toBeUndefined()
    })

    it('clears roster state when the pane cache is cleared', () => {
      claudeEvent({
        hook_event_name: 'SubagentStart',
        agent_id: 'a1',
        agent_type: 'general-purpose'
      })
      clearPaneCacheState(state, PANE_KEY)
      const stop = claudeEvent({ hook_event_name: 'Stop' })
      expect(stop?.payload.state).toBe('done')
      expect(stop?.payload.subagents).toBeUndefined()
    })

    it('does not clear a live AskUserQuestion card on subagent lifecycle events', () => {
      const question = claudeEvent({
        hook_event_name: 'PreToolUse',
        tool_name: 'AskUserQuestion',
        tool_input: { questions: [{ question: 'Pick', options: ['a', 'b'] }] }
      })
      expect(question?.payload.state).toBe('waiting')

      const spawned = claudeEvent({
        hook_event_name: 'SubagentStart',
        agent_id: 'a1',
        agent_type: 'general-purpose'
      })
      expect(spawned?.payload.state).toBe('waiting')
      expect(spawned?.payload.interactivePrompt).toBe(question?.payload.interactivePrompt)

      // Why: child-origin tool events must not overwrite the lead's cached
      // question card or read as the lead's own working state either.
      const childTool = claudeEvent({
        hook_event_name: 'PreToolUse',
        agent_id: 'a1',
        agent_type: 'general-purpose',
        tool_name: 'Bash',
        tool_input: { command: 'sleep 5' }
      })
      expect(childTool?.payload.state).toBe('waiting')
      expect(childTool?.payload.interactivePrompt).toBe(question?.payload.interactivePrompt)
      expect(childTool?.payload.toolName).toBe('AskUserQuestion')
    })

    it('preserves the interrupted flag across a gated working window', () => {
      claudeEvent({ hook_event_name: 'UserPromptSubmit', prompt: 'long job' })
      claudeEvent({
        hook_event_name: 'SubagentStart',
        agent_id: 'a1',
        agent_type: 'general-purpose'
      })
      const interruptedStop = claudeEvent({ hook_event_name: 'Stop', is_interrupt: true })
      // Why: the child is still running, so the pane stays working and the
      // parse layer clamps `interrupted` off this intermediate emit.
      expect(interruptedStop?.payload.state).toBe('working')
      expect(interruptedStop?.payload.interrupted).toBeUndefined()

      const drained = claudeEvent({ hook_event_name: 'SubagentStop', agent_id: 'a1' })
      expect(drained?.payload.state).toBe('done')
      // Why: the user's cancellation must survive to the terminal done so the
      // row reads "Interrupted by user" instead of a normal completion.
      expect(drained?.payload.interrupted).toBe(true)
    })

    it('releases a child-owned wait when the blocked child stops without another tool event', () => {
      claudeEvent({ hook_event_name: 'UserPromptSubmit', prompt: 'guarded task' })
      const blocked = claudeEvent({
        hook_event_name: 'PermissionRequest',
        agent_id: 'a-blocked',
        agent_type: 'general-purpose',
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf build' }
      })
      expect(blocked?.payload.state).toBe('waiting')

      // Why: the blocked child dying (killed, errored) must not pin the
      // permission wait on the pane forever.
      const stopped = claudeEvent({ hook_event_name: 'SubagentStop', agent_id: 'a-blocked' })
      expect(stopped?.payload.state).toBe('working')
    })

    it('restores a finished lead to done after a child permission wait clears', () => {
      claudeEvent({ hook_event_name: 'UserPromptSubmit', prompt: 'bg task' })
      claudeEvent({
        hook_event_name: 'SubagentStart',
        agent_id: 'a1',
        agent_type: 'general-purpose'
      })
      claudeEvent({
        hook_event_name: 'Stop',
        background_tasks: [{ id: 'a1', type: 'subagent', status: 'running' }]
      })

      const blocked = claudeEvent({
        hook_event_name: 'PermissionRequest',
        agent_id: 'a1',
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf build' }
      })
      expect(blocked?.payload.state).toBe('waiting')

      const approved = claudeEvent({
        hook_event_name: 'PreToolUse',
        agent_id: 'a1',
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf build' }
      })
      expect(approved?.payload.state).toBe('working')

      // Why: the lead already stopped before the wait; draining the child
      // must resolve to done, not pin the pane on an invented 'working'.
      const drained = claudeEvent({ hook_event_name: 'SubagentStop', agent_id: 'a1' })
      expect(drained?.payload.state).toBe('done')
    })

    it('resolves to done when a blocked child dies after the lead finished', () => {
      claudeEvent({ hook_event_name: 'UserPromptSubmit', prompt: 'bg task' })
      claudeEvent({
        hook_event_name: 'SubagentStart',
        agent_id: 'a1',
        agent_type: 'general-purpose'
      })
      claudeEvent({
        hook_event_name: 'Stop',
        background_tasks: [{ id: 'a1', type: 'subagent', status: 'running' }]
      })
      claudeEvent({
        hook_event_name: 'PermissionRequest',
        agent_id: 'a1',
        tool_name: 'Bash',
        tool_input: { command: 'sleep 999' }
      })

      const stopped = claudeEvent({ hook_event_name: 'SubagentStop', agent_id: 'a1' })
      expect(stopped?.payload.state).toBe('done')
    })

    it('removes a snapshot-seeded child missing from a present background_tasks list', () => {
      seedClaudeSubagentRosterFromSnapshots(state, PANE_KEY, [
        { id: 'a77', state: 'working', startedAt: 1000, agentType: 'general-purpose' }
      ])
      claudeEvent({ hook_event_name: 'UserPromptSubmit', prompt: 'after restart' })
      // Why: teams sessions never send an EMPTY list — the alive teammate
      // entry must not keep a phantom pre-restart child gating the pane.
      const stop = claudeEvent({
        hook_event_name: 'Stop',
        background_tasks: [
          { id: 'tlkjjs0jv', type: 'teammate', status: 'running', description: 'alive' }
        ]
      })
      expect(stop?.payload.state).toBe('done')
      expect(stop?.payload.subagents).toBeUndefined()
    })

    it('keeps a snapshot-seeded child working while background_tasks still lists it', () => {
      seedClaudeSubagentRosterFromSnapshots(state, PANE_KEY, [
        { id: 'a77', state: 'working', startedAt: 1000, agentType: 'general-purpose' }
      ])
      claudeEvent({ hook_event_name: 'UserPromptSubmit', prompt: 'after restart' })
      const stop = claudeEvent({
        hook_event_name: 'Stop',
        background_tasks: [{ id: 'a77', type: 'subagent', status: 'running' }]
      })
      expect(stop?.payload.state).toBe('working')
      expect(stop?.payload.subagents).toEqual([
        expect.objectContaining({ id: 'a77', state: 'working' })
      ])
    })

    it('keeps a live child omitted by the background task snapshot cap', () => {
      claudeEvent({
        hook_event_name: 'SubagentStart',
        agent_id: 'alive-after-cap',
        agent_type: 'general-purpose'
      })
      const stop = claudeEvent({
        hook_event_name: 'Stop',
        background_tasks: Array.from({ length: AGENT_STATUS_MAX_SUBAGENTS + 1 }, (_, index) => ({
          id: index === AGENT_STATUS_MAX_SUBAGENTS ? 'alive-after-cap' : `a${index}`,
          type: 'subagent',
          status: 'running'
        }))
      })

      // Why: the inventory was capped before this id, so omission cannot
      // prove the lifecycle-tracked child finished or was killed.
      expect(stop?.payload.subagents).toContainEqual(
        expect.objectContaining({ id: 'alive-after-cap', state: 'working' })
      )
      expect(stop?.payload.state).toBe('working')
    })

    it('does not adopt a known child turn-boundary event as the lead state', () => {
      claudeEvent({ hook_event_name: 'UserPromptSubmit', prompt: 'go' })
      claudeEvent({
        hook_event_name: 'SubagentStart',
        agent_id: 'a1',
        agent_type: 'general-purpose'
      })
      // Why: a CLI that stops converting child Stops to SubagentStop must not
      // retire the pane while the lead still works.
      const childStop = claudeEvent({ hook_event_name: 'Stop', agent_id: 'a1' })
      expect(childStop?.payload.state).toBe('working')
      expect(childStop?.payload.prompt).toBe('go')

      const leadStop = claudeEvent({ hook_event_name: 'Stop', background_tasks: [] })
      expect(leadStop?.payload.state).toBe('done')
    })

    it('scopes TeammateIdle to the exact teammate name for hyphen-prefix names', () => {
      claudeEvent({
        hook_event_name: 'SubagentStart',
        agent_id: 'alane-hooks-6d3cb5b5',
        agent_type: 'lane-hooks'
      })
      // Why: teammate "lane" must not idle "lane-hooks"'s rows via the
      // `a<name>-` prefix — the id suffix after the name is hyphen-free hex.
      const idledOther = claudeEvent({
        hook_event_name: 'TeammateIdle',
        teammate_name: 'lane',
        team_name: 'session-x'
      })
      expect(idledOther?.payload.subagents).toEqual([
        expect.objectContaining({ id: 'alane-hooks-6d3cb5b5', state: 'working' })
      ])

      const idled = claudeEvent({
        hook_event_name: 'TeammateIdle',
        teammate_name: 'lane-hooks',
        team_name: 'session-x'
      })
      // Why: the exact-name match parks the row idle (turn over, still alive).
      expect(idled?.payload.subagents).toEqual([
        expect.objectContaining({ id: 'alane-hooks-6d3cb5b5', state: 'idle' })
      ])
    })

    it('keeps an inferred interrupt terminal across later child lifecycle events', () => {
      claudeEvent({ hook_event_name: 'UserPromptSubmit', prompt: 'cancel me' })
      claudeEvent({
        hook_event_name: 'SubagentStart',
        agent_id: 'aprobe-1',
        agent_type: 'probe'
      })
      claudeEvent({ hook_event_name: 'SubagentStop', agent_id: 'aprobe-1' })
      markClaudeLeadTurnInterrupted(state, PANE_KEY)

      const idled = claudeEvent({
        hook_event_name: 'TeammateIdle',
        teammate_name: 'probe',
        team_name: 'session-x'
      })
      expect(idled?.payload.state).toBe('done')
      expect(idled?.payload.interrupted).toBe(true)
    })

    it('does not resurrect persisted idle child rows after a restart', () => {
      // Why: the roster tracks only working children now. A persisted idle
      // snapshot (from a build that kept idle rows) is a finished child, so
      // hydration must drop it — otherwise restart would re-pile the exact
      // squatting rows this fix removes.
      seedClaudeSubagentRosterFromSnapshots(state, PANE_KEY, [
        {
          id: 'aprobe2-6d3cb5b52120b7bf',
          state: 'idle',
          startedAt: 1000,
          agentType: 'security-reviewer'
        }
      ])
      claudeEvent({ hook_event_name: 'UserPromptSubmit', prompt: 'after restart' })
      const stop = claudeEvent({
        hook_event_name: 'Stop',
        background_tasks: [
          { id: 'tlkjjs0jv', type: 'teammate', status: 'running', description: 'alive teammate' }
        ]
      })
      expect(stop?.payload.state).toBe('done')
      expect(stop?.payload.subagents).toBeUndefined()
    })

    it('rebuilds a running one-shot subagent from background_tasks after restart', () => {
      // Why: fresh listener state (post-restart) has no roster; a Stop that
      // reports a running non-teammate task must resurrect the child row and
      // keep the pane working rather than declaring done.
      claudeEvent({ hook_event_name: 'UserPromptSubmit', prompt: 'resume' })
      const stop = claudeEvent({
        hook_event_name: 'Stop',
        background_tasks: [
          {
            id: 'a77',
            type: 'subagent',
            status: 'running',
            description: 'long build',
            agent_type: 'general-purpose'
          }
        ]
      })
      expect(stop?.payload.state).toBe('working')
      expect(stop?.payload.subagents).toEqual([
        expect.objectContaining({ id: 'a77', state: 'working', description: 'long build' })
      ])
    })
  })

  describe('writeEndpointFile', () => {
    let dir: string
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'agent-hook-listener-'))
    })
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true })
    })

    it('writes the endpoint file atomically with the right contents and mode', () => {
      const finalPath = join(dir, getEndpointFileName())
      const ok = writeEndpointFile(dir, finalPath, {
        port: 12345,
        token: 'abcdef-0123',
        env: 'production',
        version: '1'
      })
      expect(ok).toBe(true)
      const text = readFileSync(finalPath, 'utf8')
      expect(text).toContain('ORCA_AGENT_HOOK_PORT=12345')
      expect(text).toContain('ORCA_AGENT_HOOK_TOKEN=abcdef-0123')
      expect(text).toContain('ORCA_AGENT_HOOK_VERSION=1')
      // POSIX 0o600 — owner read/write only.
      if (process.platform !== 'win32') {
        const mode = statSync(finalPath).mode & 0o777
        expect(mode).toBe(0o600)
      }
    })

    it('refuses unsafe values', () => {
      const finalPath = join(dir, getEndpointFileName())
      const ok = writeEndpointFile(dir, finalPath, {
        port: 12345,
        token: 'safe-token',
        env: 'foo&bar',
        version: '1'
      })
      expect(ok).toBe(false)
    })
  })

  describe('clearClaudeAnsweredQuestionWait', () => {
    const claudeEvent = (
      payload: Record<string, unknown>
    ): ReturnType<typeof normalizeHookPayload> =>
      normalizeHookPayload(state, 'claude', { paneKey: PANE_KEY, payload }, 'production')

    it('restores working for an answered lead question and drops the card', () => {
      claudeEvent({ hook_event_name: 'UserPromptSubmit', prompt: 'pick a color' })
      const wait = claudeEvent({
        hook_event_name: 'PreToolUse',
        tool_name: 'AskUserQuestion',
        tool_input: { questions: [{ question: 'Red or Blue?' }] }
      })
      expect(wait?.payload.state).toBe('waiting')
      expect(wait?.payload.interactivePrompt).toBeDefined()

      expect(clearClaudeAnsweredQuestionWait(state, PANE_KEY)).toEqual({ state: 'working' })

      // Why: a child-driven refresh re-emits the cached lead state; the linger
      // bug would come back if it could resurrect the dismissed question.
      const childDriven = claudeEvent({
        hook_event_name: 'SubagentStart',
        agent_id: 'a1',
        agent_type: 'probe'
      })
      expect(childDriven?.payload.state).toBe('working')
      expect(childDriven?.payload.toolName).toBeUndefined()
      expect(childDriven?.payload.interactivePrompt).toBeUndefined()
    })

    it('restores the stashed lead state for an answered child question', () => {
      claudeEvent({ hook_event_name: 'UserPromptSubmit', prompt: 'go' })
      claudeEvent({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'probe' })
      claudeEvent({ hook_event_name: 'Stop' })
      const wait = claudeEvent({
        hook_event_name: 'PreToolUse',
        tool_name: 'AskUserQuestion',
        agent_id: 'a1',
        tool_input: { questions: [{ question: 'Continue?' }] }
      })
      expect(wait?.payload.state).toBe('waiting')

      // Why: the lead already finished; the answer resumes the child, so the
      // emitted state is gated up to working only while that child still runs.
      expect(clearClaudeAnsweredQuestionWait(state, PANE_KEY)).toEqual({ state: 'working' })
      expect(state.claudeLeadStateByPaneKey.get(PANE_KEY)).toEqual({ state: 'done' })

      const drained = claudeEvent({ hook_event_name: 'SubagentStop', agent_id: 'a1' })
      expect(drained?.payload.state).toBe('done')
    })

    it('falls back to working when no lead record exists', () => {
      expect(clearClaudeAnsweredQuestionWait(state, PANE_KEY)).toEqual({ state: 'working' })
    })
  })
})
