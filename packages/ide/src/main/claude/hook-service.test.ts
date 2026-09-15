// Why: locks in the remote-install contract so a refactor cannot silently
// drift the produced settings.json shape, the wrapper-quoted command path,
// or the script body that lands on the remote box. Local install behavior
// is exercised through `installer-utils.test.ts` and the per-CLI status
// audit; this file covers ONLY the SFTP-backed path added in commit #8.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi, describe, expect, it } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/userData'
  }
}))

import type { } from 'ssh2'
import { createManagedCommandMatcher } from '../agent-hooks/installer-utils'
import { ClaudeHookService } from './hook-service'

const CLAUDE_SCRIPT_FILE_NAME = process.platform === 'win32' ? 'claude-hook.cmd' : 'claude-hook.sh'
const STATUSLINE_SCRIPT_FILE_NAME =
  process.platform === 'win32' ? 'claude-statusline.cmd' : 'claude-statusline.sh'
const WINDOWS_POWERSHELL_LAUNCHER =
  /^[A-Za-z]:\/[^"]*\/System32\/WindowsPowerShell\/v1\.0\/powershell\.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand \S+$/
const isClaudeManagedCommand = createManagedCommandMatcher(CLAUDE_SCRIPT_FILE_NAME)

describe('ClaudeHookService.install', () => {
  it('installs managed hooks into Claude settings and preserves user Bedrock settings', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'orca-claude-hooks-'))
    vi.stubEnv('HOME', tmpHome)
    vi.stubEnv('USERPROFILE', tmpHome)
    try {
      const legacyPath = join(tmpHome, '.claude', 'settings.json')
      mkdirSync(join(tmpHome, '.claude'), { recursive: true })
      writeFileSync(
        legacyPath,
        JSON.stringify({
          apiKeyHelper: '/opt/company/claude-key-helper',
          awsAuthRefresh: '/opt/company/aws-refresh',
          awsCredentialExport: '/opt/company/aws-export',
          env: {
            CLAUDE_CODE_USE_BEDROCK: '1',
            AWS_REGION: 'us-west-2'
          },
          hooks: {
            Stop: [
              {
                hooks: [{ type: 'command', command: '/usr/local/bin/user-hook' }]
              },
              {
                hooks: [
                  {
                    type: 'command',
                    command: '/Users/old/.codev/agent-hooks/claude-hook.sh'
                  }
                ]
              }
            ]
          }
        })
      )

      const status = new ClaudeHookService().install()
      expect(status.state).toBe('installed')

      const legacy = JSON.parse(readFileSync(legacyPath, 'utf-8'))
      expect(legacy).toMatchObject({
        apiKeyHelper: '/opt/company/claude-key-helper',
        awsAuthRefresh: '/opt/company/aws-refresh',
        awsCredentialExport: '/opt/company/aws-export',
        env: {
          CLAUDE_CODE_USE_BEDROCK: '1',
          AWS_REGION: 'us-west-2'
        }
      })
      const legacyCommands = legacy.hooks.Stop.flatMap(
        (definition: { hooks: { command: string }[] }) =>
          definition.hooks.map((hook) => hook.command)
      )
      expect(legacyCommands).toContain('/usr/local/bin/user-hook')
      expect(legacyCommands.some((command: string) => isClaudeManagedCommand(command))).toBe(true)
      expect(
        legacyCommands.some((command: string) =>
          command.includes('/Users/old/.codev/agent-hooks/claude-hook.sh')
        )
      ).toBe(false)
      expect(isClaudeManagedCommand(legacy.hooks.StopFailure[0].hooks[0].command)).toBe(true)
      expect(
        readFileSync(join(tmpHome, '.codev', 'agent-hooks', CLAUDE_SCRIPT_FILE_NAME), 'utf-8')
      ).toContain('DEVIN_PROJECT_DIR')
    } finally {
      vi.unstubAllEnvs()
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it('installs the managed statusLine command and forwards rate_limits posts', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'orca-claude-statusline-'))
    vi.stubEnv('HOME', tmpHome)
    vi.stubEnv('USERPROFILE', tmpHome)
    try {
      expect(new ClaudeHookService().install().state).toBe('installed')

      const settings = JSON.parse(
        readFileSync(join(tmpHome, '.claude', 'settings.json'), 'utf-8')
      ) as { statusLine?: { type: string; command: string } }
      expect(settings.statusLine?.type).toBe('command')
      expect(settings.statusLine?.command).toContain('claude-statusline')

      const script = readFileSync(
        join(tmpHome, '.codev', 'agent-hooks', STATUSLINE_SCRIPT_FILE_NAME),
        'utf-8'
      )
      expect(script).toContain('/statusline/claude')
      // Why: non-subscriber sessions never carry rate_limits; both branches must guard before spawning curl.
      if (process.platform === 'win32') {
        expect(script).toContain('findstr.exe" /c:\\"rate_limits\\"')
        expect(script).toContain('--data-urlencode "payload@%ORCA_STATUSLINE_PAYLOAD_FILE%"')
      } else {
        expect(script).toContain('"rate_limits"')
        expect(script).toContain('--data-urlencode "payload@-"')
      }
    } finally {
      vi.unstubAllEnvs()
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it('never overwrites a user-owned statusLine command', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'orca-claude-user-statusline-'))
    vi.stubEnv('HOME', tmpHome)
    vi.stubEnv('USERPROFILE', tmpHome)
    try {
      const settingsPath = join(tmpHome, '.claude', 'settings.json')
      mkdirSync(join(tmpHome, '.claude'), { recursive: true })
      writeFileSync(
        settingsPath,
        JSON.stringify({ statusLine: { type: 'command', command: '/usr/local/bin/my-statusline' } })
      )

      expect(new ClaudeHookService().install().state).toBe('installed')

      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      expect(settings.statusLine).toEqual({
        type: 'command',
        command: '/usr/local/bin/my-statusline'
      })

      // remove() must also leave the user's statusLine untouched.
      new ClaudeHookService().remove()
      const afterRemove = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      expect(afterRemove.statusLine).toEqual({
        type: 'command',
        command: '/usr/local/bin/my-statusline'
      })
    } finally {
      vi.unstubAllEnvs()
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it('removes the managed statusLine on remove()', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'orca-claude-statusline-remove-'))
    vi.stubEnv('HOME', tmpHome)
    vi.stubEnv('USERPROFILE', tmpHome)
    try {
      new ClaudeHookService().install()
      new ClaudeHookService().remove()
      const settings = JSON.parse(readFileSync(join(tmpHome, '.claude', 'settings.json'), 'utf-8'))
      expect(settings.statusLine).toBeUndefined()
    } finally {
      vi.unstubAllEnvs()
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it('does not re-install a managed statusLine the user deleted, until remove() resets the opt-out', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'orca-claude-statusline-optout-'))
    vi.stubEnv('HOME', tmpHome)
    vi.stubEnv('USERPROFILE', tmpHome)
    try {
      const settingsPath = join(tmpHome, '.claude', 'settings.json')
      new ClaudeHookService().install()
      expect(JSON.parse(readFileSync(settingsPath, 'utf-8')).statusLine).toBeTruthy()

      // The user deletes the managed statusLine from settings.json (e.g. via /statusline or an editor).
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      delete settings.statusLine
      writeFileSync(settingsPath, JSON.stringify(settings))

      // A later install (app restart) must respect the deletion — statusLine is opportunistic, not required.
      new ClaudeHookService().install()
      expect(JSON.parse(readFileSync(settingsPath, 'utf-8')).statusLine).toBeUndefined()

      // An Orca-level remove() resets the opt-out memory, so a fresh install re-adds it.
      new ClaudeHookService().remove()
      new ClaudeHookService().install()
      expect(JSON.parse(readFileSync(settingsPath, 'utf-8')).statusLine).toBeTruthy()
    } finally {
      vi.unstubAllEnvs()
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it('keeps refreshing a still-managed statusLine across installs', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'orca-claude-statusline-refresh-'))
    vi.stubEnv('HOME', tmpHome)
    vi.stubEnv('USERPROFILE', tmpHome)
    try {
      const settingsPath = join(tmpHome, '.claude', 'settings.json')
      new ClaudeHookService().install()
      new ClaudeHookService().install()
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      expect(settings.statusLine?.command).toContain('claude-statusline')
    } finally {
      vi.unstubAllEnvs()
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  // Why: #6078 — Claude Code runs hooks through Git Bash, and an unquoted path
  // with a space (e.g. `C:/Users/Jane Doe`) splits at the space. The managed
  // command must use an encoded launcher so Git Bash/cmd.exe never splits or
  // expands the raw path before invoking the managed .cmd.
  it.skipIf(process.platform !== 'win32')(
    'wraps the managed hook command to survive spaces in the profile path (#6078)',
    () => {
      const tmpHome = mkdtempSync(join(tmpdir(), 'orca claude home with spaces '))
      vi.stubEnv('HOME', tmpHome)
      vi.stubEnv('USERPROFILE', tmpHome)
      try {
        expect(new ClaudeHookService().install().state).toBe('installed')

        const settings = JSON.parse(
          readFileSync(join(tmpHome, '.claude', 'settings.json'), 'utf-8')
        ) as { hooks: Record<string, { hooks: { command: string }[] }[]> }

        for (const eventName of ['UserPromptSubmit', 'Stop', 'StopFailure']) {
          const command = settings.hooks[eventName]?.[0]?.hooks?.[0]?.command
          expect(command).toMatch(WINDOWS_POWERSHELL_LAUNCHER)
        }
      } finally {
        vi.unstubAllEnvs()
        rmSync(tmpHome, { recursive: true, force: true })
      }
    }
  )

  // Why: the launcher must stay PowerShell-encoded for Git Bash, but the hook
  // POST inside the .cmd should use curl.exe so each hook spawns one
  // interpreter, not two. Posting via a second PowerShell was the slow path.
  it.skipIf(process.platform !== 'win32')(
    'posts from the managed .cmd via curl.exe, not a second PowerShell',
    () => {
      const tmpHome = mkdtempSync(join(tmpdir(), 'orca-claude-curl-'))
      vi.stubEnv('HOME', tmpHome)
      vi.stubEnv('USERPROFILE', tmpHome)
      try {
        expect(new ClaudeHookService().install().state).toBe('installed')
        const script = readFileSync(
          join(tmpHome, '.codev', 'agent-hooks', CLAUDE_SCRIPT_FILE_NAME),
          'utf-8'
        )
        expect(script).toContain('%SystemRoot%\\System32\\curl.exe')
        expect(script).toContain('--data-urlencode "payload@-"')
        expect(script).toContain('/hook/claude')
        expect(script).not.toMatch(/Invoke-WebRequest/i)
      } finally {
        vi.unstubAllEnvs()
        rmSync(tmpHome, { recursive: true, force: true })
      }
    }
  )
})

