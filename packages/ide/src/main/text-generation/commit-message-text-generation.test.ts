/* eslint-disable max-lines -- Why: local/remote generation, cancellation, and
   env propagation share subprocess mocks; splitting would obscure the
   cross-path invariants these tests protect. */
import { spawn } from 'node:child_process'
import type * as ChildProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../shared/constants'
import { sourceControlAiSettingsFromLegacy } from '../../shared/source-control-ai'
import type { GlobalSettings } from '../../shared/types'
import {
  cancelGenerateCommitMessageLocal,
  cancelGeneratePullRequestFieldsLocal,
  discoverCommitMessageModelsLocal,
  generateCommitMessageFromContext,
  generatePullRequestFieldsFromContext,
  resolveCommitMessageSettings,
  trimGeneratedCommitMessage
} from './commit-message-text-generation'

const { terminateWindowsProcessTreeMock } = vi.hoisted(() => ({
  terminateWindowsProcessTreeMock: vi.fn(async () => {})
}))

vi.mock('../windows-process-tree-kill', () => ({
  terminateWindowsProcessTree: terminateWindowsProcessTreeMock
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>()
  return {
    ...actual,
    spawn: vi.fn(actual.spawn)
  }
})

const spawnMock = vi.mocked(spawn)

type MockDiscoveryChild = EventEmitter & {
  pid: number
  kill: ReturnType<typeof vi.fn>
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: { end: ReturnType<typeof vi.fn> }
}

function createMockDiscoveryChild(): MockDiscoveryChild {
  const child = new EventEmitter() as MockDiscoveryChild
  child.pid = 123
  child.kill = vi.fn()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = { end: vi.fn() }
  return child
}

function syncSourceControlAiFromLegacy(settings: GlobalSettings): void {
  settings.sourceControlAi = sourceControlAiSettingsFromLegacy(settings.commitMessageAi)
}

function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const original = process.platform
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
  try {
    return fn()
  } finally {
    Object.defineProperty(process, 'platform', { configurable: true, value: original })
  }
}

function expectChildTerminated(child: { pid: number; kill: ReturnType<typeof vi.fn> }): void {
  if (process.platform === 'win32') {
    expect(terminateWindowsProcessTreeMock).toHaveBeenCalledWith(child.pid)
    expect(child.kill).not.toHaveBeenCalled()
    return
  }
  expect(child.kill).toHaveBeenCalledWith('SIGKILL')
}

beforeEach(() => {
  terminateWindowsProcessTreeMock.mockClear()
  terminateWindowsProcessTreeMock.mockResolvedValue(undefined)
  spawnMock.mockClear()
})

describe('resolveCommitMessageSettings', () => {
  it('falls back when a dynamic persisted model was not discovered', () => {
    const settings = getDefaultSettings('/tmp')
    settings.enableGitHubAttribution = true
    settings.commitMessageAi = {
      enabled: true,
      agentId: 'codex',
      selectedModelByAgent: { codex: 'retired-model' },
      selectedThinkingByModel: {},
      customPrompt: 'Use Conventional Commits.',
      customAgentCommand: ''
    }
    settings.sourceControlAi = undefined

    const result = resolveCommitMessageSettings(settings)

    expect(result).toEqual({
      ok: true,
      params: {
        agentId: 'codex',
        model: 'gpt-5.5',
        thinkingLevel: 'low',
        customPrompt: 'Use Conventional Commits.',
        commandInputTemplate: '{basePrompt}\n\nUse Conventional Commits.'
      }
    })
  })

  it('falls back from stale Claude version ids to the CLI alias default', () => {
    const settings = getDefaultSettings('/tmp')
    settings.commitMessageAi = {
      enabled: true,
      agentId: 'claude',
      selectedModelByAgent: { claude: 'claude-sonnet-4-6' },
      selectedThinkingByModel: { sonnet: 'low' },
      customPrompt: '',
      customAgentCommand: ''
    }
    syncSourceControlAiFromLegacy(settings)

    const result = resolveCommitMessageSettings(settings)

    expect(result).toMatchObject({
      ok: true,
      params: {
        agentId: 'claude',
        model: 'sonnet',
        thinkingLevel: 'low'
      }
    })
  })

  it("uses the user's default agent when the AI setting has no explicit agent", () => {
    const settings = getDefaultSettings('/tmp')
    settings.defaultTuiAgent = 'codex'

    const result = resolveCommitMessageSettings(settings)

    expect(result).toMatchObject({
      ok: true,
      params: {
        agentId: 'codex',
        model: 'gpt-5.5',
        thinkingLevel: 'low'
      }
    })
  })

  it('preserves dynamic persisted models that were discovered by the CLI', () => {
    const settings = getDefaultSettings('/tmp')
    settings.commitMessageAi = {
      enabled: true,
      agentId: 'codex',
      selectedModelByAgent: { codex: 'gpt-5.2' },
      discoveredModelsByAgent: {
        codex: [
          {
            id: 'gpt-5.2',
            label: 'GPT 5.2',
            thinkingLevels: [{ id: 'xhigh', label: 'Extra High' }],
            defaultThinkingLevel: 'xhigh'
          }
        ]
      },
      selectedThinkingByModel: { 'gpt-5.2': 'xhigh' },
      customPrompt: '',
      customAgentCommand: ''
    }
    syncSourceControlAiFromLegacy(settings)

    const result = resolveCommitMessageSettings(settings)

    expect(result).toMatchObject({
      ok: true,
      params: {
        agentId: 'codex',
        model: 'gpt-5.2',
        thinkingLevel: 'xhigh'
      }
    })
  })

  it('uses host-scoped discovered models for SSH worktrees', () => {
    const settings = getDefaultSettings('/tmp')
    settings.commitMessageAi = {
      enabled: true,
      agentId: 'codex',
      selectedModelByAgent: { codex: 'auto' },
      selectedModelByAgentByHost: { 'ssh:conn-1': { codex: 'remote-only' } },
      discoveredModelsByAgent: { codex: [{ id: 'auto', label: 'Auto' }] },
      discoveredModelsByAgentByHost: {
        'ssh:conn-1': { codex: [{ id: 'remote-only', label: 'Remote Only' }] }
      },
      selectedThinkingByModel: {},
      customPrompt: '',
      customAgentCommand: ''
    }
    syncSourceControlAiFromLegacy(settings)

    const result = resolveCommitMessageSettings(settings, 'ssh:conn-1')

    expect(result).toMatchObject({
      ok: true,
      params: {
        agentId: 'codex',
        model: 'remote-only'
      }
    })
  })

  it('falls back to the model default thinking level when a persisted level is stale', () => {
    const settings = getDefaultSettings('/tmp')
    settings.commitMessageAi = {
      enabled: true,
      agentId: 'codex',
      selectedModelByAgent: { codex: 'gpt-5.4-mini' },
      selectedThinkingByModel: { 'gpt-5.4-mini': 'turbo' },
      customPrompt: '',
      customAgentCommand: ''
    }
    syncSourceControlAiFromLegacy(settings)

    const result = resolveCommitMessageSettings(settings)

    expect(result).toMatchObject({
      ok: true,
      params: {
        agentId: 'codex',
        model: 'gpt-5.4-mini',
        thinkingLevel: 'low'
      }
    })
  })

  it('passes the per-agent command override into non-interactive planning', () => {
    const settings = getDefaultSettings('/tmp')
    settings.agentCmdOverrides.codex = 'npx codex'
    settings.commitMessageAi = {
      enabled: true,
      agentId: 'codex',
      selectedModelByAgent: { codex: 'gpt-5.4-mini' },
      selectedThinkingByModel: {},
      customPrompt: '',
      customAgentCommand: ''
    }
    syncSourceControlAiFromLegacy(settings)

    const result = resolveCommitMessageSettings(settings)

    expect(result).toMatchObject({
      ok: true,
      params: {
        agentId: 'codex',
        agentCommandOverride: 'npx codex'
      }
    })
  })

  it('requires a non-empty custom command for custom agents', () => {
    const settings = getDefaultSettings('/tmp')
    settings.commitMessageAi = {
      enabled: true,
      agentId: 'custom',
      selectedModelByAgent: {},
      selectedThinkingByModel: {},
      customPrompt: '',
      customAgentCommand: '   '
    }
    syncSourceControlAiFromLegacy(settings)

    expect(resolveCommitMessageSettings(settings)).toEqual({
      ok: false,
      error: 'Custom command is empty. Add one in Settings -> Git -> Source Control AI.'
    })
  })
})

describe('discoverCommitMessageModelsLocal', () => {

  it('writes the Claude list_models request to stdin and parses the control response', async () => {
    const listeners = new Map<string, (value: unknown) => void>()
    const child = {
      pid: 123,
      kill: vi.fn(),
      stdout: { on: vi.fn((event, callback) => listeners.set(`stdout:${event}`, callback)) },
      stderr: { on: vi.fn((event, callback) => listeners.set(`stderr:${event}`, callback)) },
      stdin: { on: vi.fn(), end: vi.fn() },
      on: vi.fn((event, callback) => listeners.set(event, callback))
    }
    spawnMock.mockReturnValue(child as never)

    const pending = discoverCommitMessageModelsLocal('claude', undefined)

    listeners.get('stdout:data')?.(
      Buffer.from(
        `${JSON.stringify({
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: 'orca-model-discovery',
            response: {
              models: [
                { value: 'default', displayName: 'Default (recommended)' },
                {
                  value: 'opus[1m]',
                  displayName: 'Opus (1M context)',
                  supportsEffort: true,
                  supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max']
                },
                { value: 'sonnet', displayName: 'Sonnet' },
                { value: 'haiku', displayName: 'Haiku' }
              ]
            }
          }
        })}\n`
      )
    )
    listeners.get('close')?.(0)

    await expect(pending).resolves.toMatchObject({
      success: true,
      catalogOrigin: 'probe',
      defaultModelId: 'sonnet',
      models: [
        { id: 'opus[1m]', label: 'Opus (1M context)' },
        { id: 'sonnet', label: 'Sonnet' },
        { id: 'haiku', label: 'Haiku' }
      ]
    })
    expect(spawnMock).toHaveBeenCalledWith(
      'claude',
      ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'],
      expect.objectContaining({ windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    )
    expect(child.stdin.end).toHaveBeenCalledWith(expect.stringContaining('"list_models"'))
  })

  it('falls back to the Claude seed models when the CLI lacks list_models', async () => {
    const listeners = new Map<string, (value: unknown) => void>()
    const child = {
      pid: 123,
      kill: vi.fn(),
      stdout: { on: vi.fn((event, callback) => listeners.set(`stdout:${event}`, callback)) },
      stderr: { on: vi.fn((event, callback) => listeners.set(`stderr:${event}`, callback)) },
      stdin: { on: vi.fn(), end: vi.fn() },
      on: vi.fn((event, callback) => listeners.set(event, callback))
    }
    spawnMock.mockReturnValue(child as never)

    const pending = discoverCommitMessageModelsLocal('claude', undefined)

    // Captured from claude 2.1.100: the unsupported subtype still exits 0.
    listeners.get('stdout:data')?.(
      Buffer.from(
        '{"type":"control_response","response":{"subtype":"error","request_id":"orca-model-discovery","error":"Unsupported control request subtype: list_models"}}\n'
      )
    )
    listeners.get('close')?.(0)

    await expect(pending).resolves.toMatchObject({
      success: true,
      catalogOrigin: 'spec',
      defaultModelId: 'sonnet',
      models: [{ id: 'haiku' }, { id: 'sonnet' }, { id: 'opus' }]
    })
  })

  it('keeps the Codex home locked after a discovery timeout until the child closes', async () => {
    vi.useFakeTimers()
    const firstChild = createMockDiscoveryChild()
    const secondChild = createMockDiscoveryChild()
    spawnMock.mockReturnValueOnce(firstChild as never).mockReturnValueOnce(secondChild as never)
    const env = { CODEX_HOME: '/managed/codex-discovery-home' }

    try {
      const first = discoverCommitMessageModelsLocal('codex', env)
      await vi.advanceTimersByTimeAsync(0)
      const second = discoverCommitMessageModelsLocal('codex', env)
      await vi.advanceTimersByTimeAsync(60_000)

      await expect(first).resolves.toMatchObject({
        success: false,
        error: 'Codex model discovery timed out after 60s.'
      })
      expectChildTerminated(firstChild)
      expect(spawnMock).toHaveBeenCalledTimes(1)

      firstChild.emit('close', null)
      await vi.advanceTimersByTimeAsync(0)
      expect(spawnMock).toHaveBeenCalledTimes(2)
      secondChild.stdout.emit(
        'data',
        Buffer.from(JSON.stringify({ models: [{ slug: 'gpt-5.5', display_name: 'GPT-5.5' }] }))
      )
      secondChild.emit('close', 0)
      await expect(second).resolves.toMatchObject({ success: true, defaultModelId: 'gpt-5.5' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases the Codex home after a discovery timeout once the child exits', async () => {
    vi.useFakeTimers()
    const firstChild = createMockDiscoveryChild()
    const secondChild = createMockDiscoveryChild()
    spawnMock.mockReturnValueOnce(firstChild as never).mockReturnValueOnce(secondChild as never)
    const env = { CODEX_HOME: '/managed/codex-discovery-descendant-home' }

    try {
      const first = discoverCommitMessageModelsLocal('codex', env)
      await vi.advanceTimersByTimeAsync(0)
      const second = discoverCommitMessageModelsLocal('codex', env)
      await vi.advanceTimersByTimeAsync(60_000)
      await expect(first).resolves.toMatchObject({ success: false })
      expect(spawnMock).toHaveBeenCalledTimes(1)

      // A grandchild kept the inherited stdout open, so the killed child reports
      // 'exit' and 'close' never arrives.
      firstChild.emit('exit', null, 'SIGKILL')
      await vi.advanceTimersByTimeAsync(0)
      expect(spawnMock).toHaveBeenCalledTimes(2)

      secondChild.stdout.emit(
        'data',
        Buffer.from(JSON.stringify({ models: [{ slug: 'gpt-5.5', display_name: 'GPT-5.5' }] }))
      )
      secondChild.emit('close', 0)
      await expect(second).resolves.toMatchObject({ success: true, defaultModelId: 'gpt-5.5' })
    } finally {
      vi.useRealTimers()
    }
  })

})

describe('generateCommitMessageFromContext', () => {

  it('caps local agent output before buffering unbounded data', async () => {
    const listeners = new Map<string, (value: unknown) => void>()
    const child = {
      pid: 123,
      kill: vi.fn(),
      stdout: { on: vi.fn((event, callback) => listeners.set(`stdout:${event}`, callback)) },
      stderr: { on: vi.fn((event, callback) => listeners.set(`stderr:${event}`, callback)) },
      stdin: { end: vi.fn() },
      on: vi.fn((event, callback) => listeners.set(event, callback))
    }
    spawnMock.mockReturnValue(child as never)

    const pending = generateCommitMessageFromContext(
      {
        branch: 'main',
        stagedSummary: 'M\tREADME.md',
        stagedPatch: '+hello'
      },
      {
        agentId: 'custom',
        model: '',
        customAgentCommand: 'agent'
      },
      {
        kind: 'local',
        cwd: '/repo'
      }
    )

    listeners.get('stdout:data')?.(Buffer.alloc(4 * 1024 * 1024 + 1))
    listeners.get('close')?.(null)

    await expect(pending).resolves.toEqual({
      success: false,
      error:
        'agent CLI command produced too much output. Check the agent CLI configuration and try again.'
    })
    expectChildTerminated(child)
  })

  it('passes prepared provider environment to local agent subprocesses', async () => {
    const listeners = new Map<string, (value: unknown) => void>()
    const child = {
      pid: 123,
      kill: vi.fn(),
      stdout: { on: vi.fn((event, callback) => listeners.set(`stdout:${event}`, callback)) },
      stderr: { on: vi.fn((event, callback) => listeners.set(`stderr:${event}`, callback)) },
      stdin: { end: vi.fn() },
      on: vi.fn((event, callback) => listeners.set(event, callback))
    }
    spawnMock.mockReturnValue(child as never)

    const pending = generateCommitMessageFromContext(
      {
        branch: 'main',
        stagedSummary: 'M\tREADME.md',
        stagedPatch: '+hello'
      },
      {
        agentId: 'custom',
        model: '',
        customAgentCommand: 'orca-test-agent-nope'
      },
      {
        kind: 'local',
        cwd: '/repo',
        env: { ...process.env, CODEX_HOME: '/managed/codex-home' }
      }
    )

    listeners.get('stdout:data')?.(Buffer.from('Add README note\n'))
    listeners.get('close')?.(0)

    await expect(pending).resolves.toMatchObject({
      success: true,
      message: 'Add README note'
    })
    expect(spawnMock).toHaveBeenCalledWith(
      'orca-test-agent-nope',
      [],
      expect.objectContaining({
        env: expect.objectContaining({ CODEX_HOME: '/managed/codex-home' })
      })
    )
  })

  it('routes WSL local commit generation through the selected distro login shell', async () => {
    await withPlatform('win32', async () => {
      process.env.ORCA_HOST_ONLY_SECRET = 'do-not-leak'
      const listeners = new Map<string, (value: unknown) => void>()
      const child = {
        pid: 123,
        kill: vi.fn(),
        stdout: { on: vi.fn((event, callback) => listeners.set(`stdout:${event}`, callback)) },
        stderr: { on: vi.fn((event, callback) => listeners.set(`stderr:${event}`, callback)) },
        stdin: { end: vi.fn() },
        on: vi.fn((event, callback) => listeners.set(event, callback))
      }
      spawnMock.mockReturnValue(child as never)

      const pending = generateCommitMessageFromContext(
        {
          branch: 'main',
          stagedSummary: 'M\tREADME.md',
          stagedPatch: '+hello'
        },
        {
          agentId: 'custom',
          model: '',
          customAgentCommand: 'agent --mode fast'
        },
        {
          kind: 'local',
          cwd: 'C:\\repo',
          wslDistro: 'Ubuntu 24.04',
          env: { ...process.env, CODEX_HOME: '/home/tester/.codex' }
        }
      )

      listeners.get('stdout:data')?.(Buffer.from('Update README\n'))
      listeners.get('close')?.(0)

      await expect(pending).resolves.toMatchObject({
        success: true,
        message: 'Update README'
      })
      expect(spawnMock).toHaveBeenCalledWith(
        'wsl.exe',
        ['-d', 'Ubuntu 24.04', '--', 'sh', '-lc', expect.any(String)],
        expect.objectContaining({
          cwd: undefined,
          windowsHide: true,
          env: expect.objectContaining({ CODEX_HOME: '/home/tester/.codex' })
        })
      )
      const spawnEnv = spawnMock.mock.calls[0]?.[2]?.env as NodeJS.ProcessEnv
      expect(spawnEnv.ORCA_HOST_ONLY_SECRET).toBeUndefined()
      const shellCommand = spawnMock.mock.calls[0]?.[1]?.[5] as string
      expect(shellCommand).toContain('getent passwd')
      expect(shellCommand).toContain('exec "\\$_orca_wsl_shell" -ilc')
      expect(shellCommand).toContain('/mnt/c/repo')
      expect(shellCommand).toContain("'agent'")
      expect(shellCommand).toContain('--mode')
      expect(shellCommand).toContain('fast')
    })
  })

  it('keeps local commit-message and pull-request cancellation lanes separate', async () => {
    const children: {
      pid: number
      kill: ReturnType<typeof vi.fn>
      listeners: Map<string, (value: unknown) => void>
    }[] = []
    spawnMock.mockImplementation(() => {
      const listeners = new Map<string, (value: unknown) => void>()
      const child = {
        pid: 123 + children.length,
        kill: vi.fn(),
        stdout: { on: vi.fn((event, callback) => listeners.set(`stdout:${event}`, callback)) },
        stderr: { on: vi.fn((event, callback) => listeners.set(`stderr:${event}`, callback)) },
        stdin: { end: vi.fn() },
        on: vi.fn((event, callback) => listeners.set(event, callback))
      }
      children.push({ pid: child.pid, kill: child.kill, listeners })
      return child as never
    })

    const commit = generateCommitMessageFromContext(
      {
        branch: 'main',
        stagedSummary: 'M\tREADME.md',
        stagedPatch: '+hello'
      },
      {
        agentId: 'custom',
        model: '',
        customAgentCommand: 'agent'
      },
      {
        kind: 'local',
        cwd: '/repo'
      }
    )
    const pullRequest = generatePullRequestFieldsFromContext(
      {
        branch: 'feature/pr-fields',
        base: 'main',
        branchChangedByPreparation: false,
        currentTitle: '',
        currentBody: '',
        currentDraft: false,
        commitSummary: '- feat: update README',
        changeSummary: 'M\tREADME.md',
        patch: '+hello'
      },
      {
        agentId: 'custom',
        model: '',
        customAgentCommand: 'agent'
      },
      {
        kind: 'local',
        cwd: '/repo'
      }
    )

    cancelGenerateCommitMessageLocal('/repo')

    expectChildTerminated(children[0]!)
    expect(children[1]?.kill).not.toHaveBeenCalled()

    children[0]?.listeners.get('close')?.(null)
    const pullRequestStdout = children[1]?.listeners.get('stdout:data')
    pullRequestStdout?.(
      Buffer.from('{"base":"main","title":"Update README","body":"Details","draft":false}')
    )
    children[1]?.listeners.get('close')?.(0)

    await expect(commit).resolves.toEqual({
      success: false,
      error: 'Generation canceled.',
      canceled: true
    })
    await expect(pullRequest).resolves.toMatchObject({
      success: true,
      fields: {
        base: 'main',
        title: 'Update README',
        body: 'Details',
        draft: false
      }
    })

    cancelGeneratePullRequestFieldsLocal('/repo')
    expect(children[1]?.kill).not.toHaveBeenCalled()
  })

  it('keeps local pull-request cancellation from stopping commit-message generation', async () => {
    const children: {
      pid: number
      kill: ReturnType<typeof vi.fn>
      listeners: Map<string, (value: unknown) => void>
    }[] = []
    spawnMock.mockImplementation(() => {
      const listeners = new Map<string, (value: unknown) => void>()
      const child = {
        pid: 123 + children.length,
        kill: vi.fn(),
        stdout: { on: vi.fn((event, callback) => listeners.set(`stdout:${event}`, callback)) },
        stderr: { on: vi.fn((event, callback) => listeners.set(`stderr:${event}`, callback)) },
        stdin: { end: vi.fn() },
        on: vi.fn((event, callback) => listeners.set(event, callback))
      }
      children.push({ pid: child.pid, kill: child.kill, listeners })
      return child as never
    })

    const commit = generateCommitMessageFromContext(
      {
        branch: 'main',
        stagedSummary: 'M\tREADME.md',
        stagedPatch: '+hello'
      },
      {
        agentId: 'custom',
        model: '',
        customAgentCommand: 'agent'
      },
      {
        kind: 'local',
        cwd: '/repo'
      }
    )
    const pullRequest = generatePullRequestFieldsFromContext(
      {
        branch: 'feature/pr-fields',
        base: 'main',
        branchChangedByPreparation: false,
        currentTitle: '',
        currentBody: '',
        currentDraft: false,
        commitSummary: '- feat: update README',
        changeSummary: 'M\tREADME.md',
        patch: '+hello'
      },
      {
        agentId: 'custom',
        model: '',
        customAgentCommand: 'agent'
      },
      {
        kind: 'local',
        cwd: '/repo'
      }
    )

    cancelGeneratePullRequestFieldsLocal('/repo')

    expect(children[0]?.kill).not.toHaveBeenCalled()
    expectChildTerminated(children[1]!)

    const commitStdout = children[0]?.listeners.get('stdout:data')
    commitStdout?.(Buffer.from('Update README\n'))
    children[0]?.listeners.get('close')?.(0)
    children[1]?.listeners.get('close')?.(null)

    await expect(commit).resolves.toEqual({
      success: true,
      message: 'Update README',
      agentLabel: 'agent'
    })
    await expect(pullRequest).resolves.toEqual({
      success: false,
      error: 'Generation canceled.',
      canceled: true,
      branchChangedByPreparation: false
    })
  })

  it('reports branch changes when pull request field output cannot be parsed', async () => {
    const listeners = new Map<string, (value: unknown) => void>()
    spawnMock.mockReturnValue({
      pid: 123,
      kill: vi.fn(),
      stdout: { on: vi.fn((event, callback) => listeners.set(`stdout:${event}`, callback)) },
      stderr: { on: vi.fn((event, callback) => listeners.set(`stderr:${event}`, callback)) },
      stdin: { end: vi.fn() },
      on: vi.fn((event, callback) => listeners.set(event, callback))
    } as never)

    const pullRequest = generatePullRequestFieldsFromContext(
      {
        branch: 'feature/pr-fields',
        base: 'main',
        branchChangedByPreparation: true,
        currentTitle: '',
        currentBody: '',
        currentDraft: false,
        commitSummary: '- feat: update README',
        changeSummary: 'M\tREADME.md',
        patch: '+hello'
      },
      {
        agentId: 'custom',
        model: '',
        customAgentCommand: 'agent'
      },
      {
        kind: 'local',
        cwd: '/repo'
      }
    )

    listeners.get('stdout:data')?.(Buffer.from('not json'))
    listeners.get('close')?.(0)

    await expect(pullRequest).resolves.toEqual({
      success: false,
      error: 'Generated pull request details could not be parsed.',
      branchChangedByPreparation: true
    })
  })

  it('reports branch changes when pull request generation is canceled', async () => {
    const listeners = new Map<string, (value: unknown) => void>()
    const child = {
      pid: 123,
      kill: vi.fn(),
      stdout: { on: vi.fn((event, callback) => listeners.set(`stdout:${event}`, callback)) },
      stderr: { on: vi.fn((event, callback) => listeners.set(`stderr:${event}`, callback)) },
      stdin: { end: vi.fn() },
      on: vi.fn((event, callback) => listeners.set(event, callback))
    }
    spawnMock.mockReturnValue(child as never)

    const pullRequest = generatePullRequestFieldsFromContext(
      {
        branch: 'feature/pr-fields',
        base: 'main',
        branchChangedByPreparation: true,
        currentTitle: '',
        currentBody: '',
        currentDraft: false,
        commitSummary: '- feat: update README',
        changeSummary: 'M\tREADME.md',
        patch: '+hello'
      },
      {
        agentId: 'custom',
        model: '',
        customAgentCommand: 'agent'
      },
      {
        kind: 'local',
        cwd: '/repo'
      }
    )

    cancelGeneratePullRequestFieldsLocal('/repo')
    listeners.get('close')?.(null)

    expectChildTerminated(child)
    await expect(pullRequest).resolves.toEqual({
      success: false,
      error: 'Generation canceled.',
      canceled: true,
      branchChangedByPreparation: true
    })
  })

  it('settles local commit-message cancellation even when the killed child does not close', async () => {
    vi.useFakeTimers()
    try {
      const listeners = new Map<string, (value: unknown) => void>()
      const removeListener = (key: string, callback: (value: unknown) => void): void => {
        if (listeners.get(key) === callback) {
          listeners.delete(key)
        }
      }
      const child = {
        pid: 123,
        kill: vi.fn(),
        stdout: {
          on: vi.fn((event, callback) => listeners.set(`stdout:${event}`, callback)),
          off: vi.fn((event, callback) => removeListener(`stdout:${event}`, callback))
        },
        stderr: {
          on: vi.fn((event, callback) => listeners.set(`stderr:${event}`, callback)),
          off: vi.fn((event, callback) => removeListener(`stderr:${event}`, callback))
        },
        stdin: { end: vi.fn() },
        on: vi.fn((event, callback) => listeners.set(event, callback)),
        off: vi.fn((event, callback) => removeListener(event, callback))
      }
      spawnMock.mockReturnValue(child as never)

      const pending = generateCommitMessageFromContext(
        {
          branch: 'main',
          stagedSummary: 'M\tREADME.md',
          stagedPatch: '+hello'
        },
        {
          agentId: 'custom',
          model: '',
          customAgentCommand: 'agent'
        },
        {
          kind: 'local',
          cwd: '/repo'
        }
      )
      const outcomePromise = pending.then((result) =>
        !result.success && result.canceled ? 'canceled' : 'other'
      )

      cancelGenerateCommitMessageLocal('/repo')
      expectChildTerminated(child)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      const outcome = await Promise.race([outcomePromise, Promise.resolve('pending')])

      expect(outcome).toBe('canceled')
      expect(listeners.has('stdout:data')).toBe(false)
      expect(listeners.has('stderr:data')).toBe(false)
      expect(listeners.has('error')).toBe(false)
      expect(listeners.has('close')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('publishes Codex cancellation immediately but holds its home lock until close', async () => {
    const firstChild = createMockDiscoveryChild()
    const secondChild = createMockDiscoveryChild()
    spawnMock.mockReturnValueOnce(firstChild as never).mockReturnValueOnce(secondChild as never)
    const env = { CODEX_HOME: '/managed/codex-generation-home' }
    const context = { branch: 'main', stagedSummary: 'M\tREADME.md', stagedPatch: '+hello' }
    const params = { agentId: 'codex' as const, model: 'gpt-5.5' }

    const first = generateCommitMessageFromContext(context, params, {
      kind: 'local',
      cwd: '/repo',
      env
    })
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1))
    cancelGenerateCommitMessageLocal('/repo')

    await expect(first).resolves.toEqual({
      success: false,
      error: 'Generation canceled.',
      canceled: true
    })
    expectChildTerminated(firstChild)

    const second = generateCommitMessageFromContext(context, params, {
      kind: 'local',
      cwd: '/repo-2',
      env
    })
    await Promise.resolve()
    expect(spawnMock).toHaveBeenCalledTimes(1)

    firstChild.emit('close', null)
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(2))
    secondChild.stdout.emit('data', Buffer.from('Update README\n'))
    secondChild.emit('close', 0)
    await expect(second).resolves.toMatchObject({ success: true, message: 'Update README' })
  })

  it('releases the Codex home lock when the child exits with a descendant holding its stdio', async () => {
    const firstChild = createMockDiscoveryChild()
    const secondChild = createMockDiscoveryChild()
    spawnMock.mockReturnValueOnce(firstChild as never).mockReturnValueOnce(secondChild as never)
    const env = { CODEX_HOME: '/managed/codex-descendant-home' }
    const context = { branch: 'main', stagedSummary: 'M\tREADME.md', stagedPatch: '+hello' }
    const params = { agentId: 'codex' as const, model: 'gpt-5.5' }

    const first = generateCommitMessageFromContext(context, params, {
      kind: 'local',
      cwd: '/descendant-repo',
      env
    })
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1))
    cancelGenerateCommitMessageLocal('/descendant-repo')
    await expect(first).resolves.toMatchObject({ canceled: true })
    expectChildTerminated(firstChild)

    // SIGKILL reaches the codex process but not a grandchild that inherited its
    // stdout, so 'exit' arrives and 'close' never does.
    firstChild.emit('exit', null, 'SIGKILL')

    const second = generateCommitMessageFromContext(context, params, {
      kind: 'local',
      cwd: '/descendant-repo-2',
      env
    })
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(2))
    secondChild.stdout.emit('data', Buffer.from('Update README\n'))
    secondChild.emit('close', 0)
    await expect(second).resolves.toMatchObject({ success: true, message: 'Update README' })
  })

  it('holds the Codex home lock until Windows tree termination and wrapper close', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    let finishTreeKill!: () => void
    terminateWindowsProcessTreeMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishTreeKill = resolve
      })
    )
    const firstChild = createMockDiscoveryChild()
    const secondChild = createMockDiscoveryChild()
    spawnMock.mockReturnValueOnce(firstChild as never).mockReturnValueOnce(secondChild as never)
    const env = { CODEX_HOME: 'C:\\managed\\codex-generation-home' }
    const context = { branch: 'main', stagedSummary: 'M\tREADME.md', stagedPatch: '+hello' }
    const params = { agentId: 'codex' as const, model: 'gpt-5.5' }

    try {
      const first = generateCommitMessageFromContext(context, params, {
        kind: 'local',
        cwd: 'C:\\repo',
        env
      })
      await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1))
      cancelGenerateCommitMessageLocal('C:\\repo')
      await expect(first).resolves.toMatchObject({ canceled: true })

      const second = generateCommitMessageFromContext(context, params, {
        kind: 'local',
        cwd: 'C:\\repo-2',
        env
      })
      firstChild.emit('close', null)
      await Promise.resolve()
      expect(spawnMock).toHaveBeenCalledTimes(1)

      finishTreeKill()
      await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(2))
      secondChild.stdout.emit('data', Buffer.from('Update README\n'))
      secondChild.emit('close', 0)
      await expect(second).resolves.toMatchObject({ success: true, message: 'Update README' })
    } finally {
      Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
    }
  })

  it('cancels Codex generation promptly while it is queued behind the home lock', async () => {
    const discoveryChild = createMockDiscoveryChild()
    const laterChild = createMockDiscoveryChild()
    spawnMock.mockReturnValueOnce(discoveryChild as never).mockReturnValueOnce(laterChild as never)
    const env = { CODEX_HOME: '/managed/codex-queued-home' }
    const blocker = discoverCommitMessageModelsLocal('codex', env)
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1))

    const queued = generateCommitMessageFromContext(
      { branch: 'main', stagedSummary: 'M\tREADME.md', stagedPatch: '+hello' },
      { agentId: 'codex', model: 'gpt-5.5' },
      { kind: 'local', cwd: '/queued-repo', env }
    )
    cancelGenerateCommitMessageLocal('/queued-repo')

    await expect(queued).resolves.toEqual({
      success: false,
      error: 'Generation canceled.',
      canceled: true
    })
    expect(spawnMock).toHaveBeenCalledTimes(1)

    discoveryChild.stdout.emit(
      'data',
      Buffer.from(JSON.stringify({ models: [{ slug: 'gpt-5.5', display_name: 'GPT-5.5' }] }))
    )
    discoveryChild.emit('close', 0)
    await expect(blocker).resolves.toMatchObject({ success: true })

    const later = generateCommitMessageFromContext(
      { branch: 'main', stagedSummary: 'M\tREADME.md', stagedPatch: '+later' },
      { agentId: 'codex', model: 'gpt-5.5' },
      { kind: 'local', cwd: '/later-repo', env }
    )
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(2))
    laterChild.stdout.emit('data', Buffer.from('Update later\n'))
    laterChild.emit('close', 0)
    await expect(later).resolves.toMatchObject({ success: true, message: 'Update later' })
  })

  it('routes Windows batch-script agent commands through cmd.exe', async () => {
    const originalComSpec = process.env.ComSpec
    process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe'
    try {
      await withPlatform('win32', async () => {
        const listeners = new Map<string, (value: unknown) => void>()
        const child = {
          pid: 123,
          kill: vi.fn(),
          stdout: { on: vi.fn((event, callback) => listeners.set(`stdout:${event}`, callback)) },
          stderr: { on: vi.fn((event, callback) => listeners.set(`stderr:${event}`, callback)) },
          stdin: { end: vi.fn() },
          on: vi.fn((event, callback) => listeners.set(event, callback))
        }
        spawnMock.mockReturnValue(child as never)

        const pending = generateCommitMessageFromContext(
          {
            branch: 'main',
            stagedSummary: 'M\tREADME.md',
            stagedPatch: '+hello'
          },
          {
            agentId: 'custom',
            model: '',
            customAgentCommand: 'C:/tools/agent.cmd'
          },
          {
            kind: 'local',
            cwd: 'C:\\repo'
          }
        )

        listeners.get('stdout:data')?.(Buffer.from('Update README\n'))
        listeners.get('close')?.(0)

        await expect(pending).resolves.toMatchObject({
          success: true,
          message: 'Update README'
        })
        expect(spawnMock).toHaveBeenCalledWith(
          'C:\\Windows\\System32\\cmd.exe',
          ['/d', '/c', 'C:/tools/agent.cmd'],
          expect.objectContaining({
            cwd: 'C:\\repo',
            windowsHide: true
          })
        )
      })
    } finally {
      if (originalComSpec === undefined) {
        delete process.env.ComSpec
      } else {
        process.env.ComSpec = originalComSpec
      }
    }
  })

  it('rejects unsafe argv prompts for Windows batch-script agent commands', async () => {
    await withPlatform('win32', async () => {
      const result = await generateCommitMessageFromContext(
        {
          branch: 'main',
          stagedSummary: 'M\tREADME.md',
          stagedPatch: '+hello & goodbye'
        },
        {
          agentId: 'custom',
          model: '',
          customAgentCommand: 'C:/tools/agent.cmd {prompt}'
        },
        {
          kind: 'local',
          cwd: 'C:\\repo'
        }
      )

      expect(result).toEqual({
        success: false,
        error:
          'C:/tools/agent.cmd cannot be run as a Windows batch command with the prompt in argv. Remove {prompt} so Orca sends the prompt on stdin.'
      })
      expect(spawnMock).not.toHaveBeenCalled()
    })
  })
})

describe('trimGeneratedCommitMessage', () => {
  it('removes trailing whitespace from generated messages', () => {
    const message = trimGeneratedCommitMessage('Update docs\n\n')

    expect(message).toBe('Update docs')
  })
})
