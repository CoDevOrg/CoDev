import { describe, expect, it } from 'vitest'
import {
  buildAgentDraftLaunchPlan,
  buildAgentResumeStartupPlan,
  buildAgentStartupPlan,
  buildShellCommandFromArgv,
  planAgentCliArgsSuffix
} from './tui-agent-startup'

describe('tui agent startup plans', () => {
  it.each(['powershell', 'cmd'] as const)(
    'keeps the established invalid-quote error on %s',
    (shell) => {
      expect(planAgentCliArgsSuffix('--model "unterminated', shell)).toEqual({
        ok: false,
        error: 'CLI arguments are invalid: Unclosed quote in command template.'
      })
    }
  )

  it('uses POSIX quoting when the target shell is Linux', () => {
    const plan = buildAgentStartupPlan({
      agent: 'claude',
      prompt: "fix Bob's branch",
      cmdOverrides: {},
      platform: 'linux'
    })

    expect(plan?.launchCommand).toBe("claude 'fix Bob'\\''s branch'")
  })

  it('uses PowerShell quoting by default when the target shell is Windows', () => {
    const plan = buildAgentStartupPlan({
      agent: 'claude',
      prompt: 'fix Bob\'s "quoted" branch',
      cmdOverrides: {},
      platform: 'win32'
    })

    expect(plan?.launchCommand).toBe("claude 'fix Bob''s \"quoted\" branch'")
  })

  it('invokes fully quoted argv commands in PowerShell', () => {
    expect(buildShellCommandFromArgv(['codex', 'resume', 's1'], 'powershell')).toBe(
      "& 'codex' 'resume' 's1'"
    )
  })

  it('uses cmd escaping when requested explicitly', () => {
    const plan = buildAgentStartupPlan({
      agent: 'claude',
      prompt: 'fix "quoted" & %PATH%',
      cmdOverrides: {},
      platform: 'win32',
      shell: 'cmd'
    })

    expect(plan?.launchCommand).toBe('claude "fix ^"quoted^" ^& ^%PATH^%"')
  })

  it('does not add a prompt separator for argv agents that do not declare one', () => {
    const plan = buildAgentStartupPlan({
      agent: 'codex',
      prompt: '--version',
      cmdOverrides: {},
      platform: 'linux'
    })

    expect(plan?.launchCommand).toBe("codex '--version'")
  })

  it('does not launch Codex with the Orca profile when agent status hooks are enabled', () => {
    const plan = buildAgentStartupPlan({
      agent: 'codex',
      prompt: 'fix it',
      cmdOverrides: {},
      platform: 'linux'
    })

    expect(plan?.launchCommand).toBe("codex 'fix it'")
    expect(plan?.startupCommandDelivery).toBe('shell-ready')
  })

  it('keeps plain empty Codex startup on the fast delivery path', () => {
    const plan = buildAgentStartupPlan({
      agent: 'codex',
      prompt: '',
      cmdOverrides: {},
      platform: 'linux',
      allowEmptyPromptLaunch: true
    })

    expect(plan).toEqual({
      agent: 'codex',
      launchCommand: 'codex',
      expectedProcess: 'codex',
      followupPrompt: null,
      launchConfig: { agentCommand: 'codex', agentArgs: '', agentEnv: {} }
    })
  })

  it('launches Claude without Orca settings injection', () => {
    const plan = buildAgentStartupPlan({
      agent: 'claude',
      prompt: 'fix it',
      cmdOverrides: {},
      platform: 'linux'
    })

    expect(plan?.launchCommand).toBe("claude 'fix it'")
    expect(plan?.launchCommand).not.toContain('--settings')
  })

  it('uses the Linux Orca CLI command for Claude Agent Teams launches', () => {
    const plan = buildAgentStartupPlan({
      agent: 'claude-agent-teams',
      prompt: '',
      cmdOverrides: {},
      platform: 'linux',
      allowEmptyPromptLaunch: true
    })

    expect(plan?.launchCommand).toBe('codev claude-teams')
  })

  it('uses the plain orca shim for Claude Agent Teams on Linux SSH remotes', () => {
    // Why: the SSH relay deploys the CLI shim as `orca` (not the local-only
    // `codev` GNOME-screen-reader workaround), so a remote launch must not
    // emit `codev claude-teams` — that name is not on the remote PATH and
    // `claude-teams` is rejected by the relay's CLI switch (issue #6500).
    const plan = buildAgentStartupPlan({
      agent: 'claude-agent-teams',
      prompt: '',
      cmdOverrides: {},
      platform: 'linux',
      isRemote: true,
      allowEmptyPromptLaunch: true
    })

    expect(plan?.launchCommand).toBe('orca claude-teams')
  })

  it('keeps the Windows orca.cmd shim for Claude Agent Teams on SSH remotes', () => {
    // Why: the Windows remote shim is also `orca.cmd`, matching the local
    // win32 override, so remoteness must not alter the Windows command.
    const plan = buildAgentStartupPlan({
      agent: 'claude-agent-teams',
      prompt: '',
      cmdOverrides: {},
      platform: 'win32',
      isRemote: true,
      allowEmptyPromptLaunch: true
    })

    expect(plan?.launchCommand).toBe('orca.cmd claude-teams')
  })

  it('keeps the Linux codev wrapper for local (non-remote) Claude Agent Teams', () => {
    // Why: the `codev` rename is still required for a local Linux desktop
    // install (avoids shadowing the GNOME Orca screen reader), so an explicit
    // isRemote:false must preserve it.
    const plan = buildAgentStartupPlan({
      agent: 'claude-agent-teams',
      prompt: '',
      cmdOverrides: {},
      platform: 'linux',
      isRemote: false,
      allowEmptyPromptLaunch: true
    })

    expect(plan?.launchCommand).toBe('codev claude-teams')
  })

  it('leaves Claude command overrides untouched', () => {
    const plan = buildAgentStartupPlan({
      agent: 'claude',
      prompt: 'fix it',
      cmdOverrides: { claude: 'claude --dangerously-skip-permissions' },
      platform: 'linux'
    })

    expect(plan?.launchCommand).toBe("claude --dangerously-skip-permissions 'fix it'")
  })

  it('leaves Codex command overrides untouched', () => {
    const plan = buildAgentStartupPlan({
      agent: 'codex',
      prompt: 'fix it',
      cmdOverrides: { codex: 'codex --profile work' },
      platform: 'linux'
    })

    expect(plan?.launchCommand).toBe("codex --profile work 'fix it'")
  })

  it('builds Windows resume plans that PowerShell can invoke', () => {
    const plan = buildAgentResumeStartupPlan({
      agent: 'codex',
      providerSession: { key: 'session_id', id: 's1' },
      cmdOverrides: {},
      platform: 'win32'
    })

    expect(plan?.launchCommand).toBe("codex 'resume' 's1'")
  })

  it('honors command overrides when building POSIX resume plans', () => {
    const plan = buildAgentResumeStartupPlan({
      agent: 'codex',
      providerSession: { key: 'session_id', id: 's1' },
      cmdOverrides: { codex: 'codex --profile work' },
      platform: 'linux'
    })

    expect(plan?.launchCommand).toBe("codex --profile work 'resume' 's1'")
  })

  it('uses a captured launch command when building resume plans after overrides change', () => {
    const plan = buildAgentResumeStartupPlan({
      agent: 'codex',
      providerSession: { key: 'session_id', id: 's1' },
      cmdOverrides: { codex: 'codex --profile changed' },
      agentCommand: 'codex --profile captured',
      platform: 'linux'
    })

    expect(plan?.launchCommand).toBe("codex --profile captured 'resume' 's1'")
    expect(plan?.launchConfig).toEqual({
      agentCommand: 'codex --profile captured',
      agentArgs: '',
      agentEnv: {}
    })
  })

  it('appends shell-quoted CLI arguments before prompt delivery flags', () => {
    const plan = buildAgentStartupPlan({
      agent: 'claude',
      prompt: 'fix it',
      cmdOverrides: {},
      agentArgs: '--model sonnet --add-dir "path with spaces"',
      platform: 'linux'
    })

    expect(plan?.launchCommand).toBe(
      "claude '--model' 'sonnet' '--add-dir' 'path with spaces' 'fix it'"
    )
  })

  it('uses PowerShell quoting for CLI arguments on Windows', () => {
    const plan = buildAgentStartupPlan({
      agent: 'claude',
      prompt: 'fix it',
      cmdOverrides: {},
      agentArgs: '--model sonnet --name "Bob\'s"',
      platform: 'win32'
    })

    expect(plan?.launchCommand).toBe("claude '--model' 'sonnet' '--name' 'Bob''s' 'fix it'")
  })

  it('carries agent launch environment defaults into startup plans', () => {
    const plan = buildAgentStartupPlan({
      agent: 'codex',
      prompt: '',
      cmdOverrides: {},
      agentEnv: { CODEX_PROFILE: 'work' },
      platform: 'linux',
      allowEmptyPromptLaunch: true
    })

    expect(plan?.launchCommand).toBe('codex')
    expect(plan?.env).toEqual({ CODEX_PROFILE: 'work' })
    expect(plan?.launchConfig).toEqual({
      agentCommand: 'codex',
      agentArgs: '',
      agentEnv: { CODEX_PROFILE: 'work' }
    })
  })

  it('captures empty args and env as explicit launch config values', () => {
    const plan = buildAgentStartupPlan({
      agent: 'claude',
      prompt: '',
      cmdOverrides: {},
      agentArgs: '',
      agentEnv: {},
      platform: 'linux',
      allowEmptyPromptLaunch: true
    })

    expect(plan?.launchConfig).toEqual({ agentCommand: 'claude', agentArgs: '', agentEnv: {} })
  })

  it('returns null for oversized Windows flag drafts so callers paste after ready', () => {
    expect(
      buildAgentDraftLaunchPlan({
        agent: 'claude',
        draft: 'x'.repeat(25_000),
        cmdOverrides: {},
        platform: 'win32'
      })
    ).toBeNull()
  })
})
