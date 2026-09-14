import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testState = { fakeHomeDir: '', userDataDir: '' }

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') {
        return testState.userDataDir
      }
      throw new Error(`unexpected app.getPath(${name})`)
    }
  }
}))

vi.mock('node:os', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.importActual requires inline import()
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return { ...actual, homedir: () => testState.fakeHomeDir }
})

const { markClaudeProjectTrusted } = await import('./agent-trust-presets')

let previousConfigDir: string | undefined

beforeEach(() => {
  testState.fakeHomeDir = mkdtempSync(join(tmpdir(), 'orca-claude-trust-'))
  testState.userDataDir = mkdtempSync(join(tmpdir(), 'orca-claude-trust-user-data-'))
  previousConfigDir = process.env.CLAUDE_CONFIG_DIR
  delete process.env.CLAUDE_CONFIG_DIR
})

afterEach(() => {
  rmSync(testState.fakeHomeDir, { recursive: true, force: true })
  rmSync(testState.userDataDir, { recursive: true, force: true })
  if (previousConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = previousConfigDir
  }
})

function makeWorktree(): string {
  const worktree = join(testState.fakeHomeDir, 'orca', 'workspaces', 'repo', 'claude-a1b2c3d4')
  mkdirSync(worktree, { recursive: true })
  return realpathSync.native(worktree)
}

type ClaudeConfig = {
  hasCompletedOnboarding?: boolean
  mcpServers: Record<string, { url: string }>
  projects: Record<string, Record<string, unknown>>
}

function readConfig(path = join(testState.fakeHomeDir, '.claude.json')): ClaudeConfig {
  return JSON.parse(readFileSync(path, 'utf-8')) as ClaudeConfig
}

describe('markClaudeProjectTrusted', () => {
  it('trusts the exact worktree and keeps every other key', () => {
    const worktree = makeWorktree()
    writeFileSync(
      join(testState.fakeHomeDir, '.claude.json'),
      JSON.stringify({
        hasCompletedOnboarding: true,
        mcpServers: { 'codev-coordination': { url: 'https://example.test' } },
        projects: {
          '/srv/codev/workspaces/w': { hasTrustDialogAccepted: true },
          [worktree]: { allowedTools: ['Read'] }
        }
      })
    )

    markClaudeProjectTrusted(worktree)

    const config = readConfig()
    expect(config.hasCompletedOnboarding).toBe(true)
    expect(config.mcpServers['codev-coordination'].url).toBe('https://example.test')
    expect(config.projects['/srv/codev/workspaces/w'].hasTrustDialogAccepted).toBe(true)
    expect(config.projects[worktree]).toEqual({
      allowedTools: ['Read'],
      hasTrustDialogAccepted: true
    })
  })

  it('creates an owner-only config when none exists', () => {
    const worktree = makeWorktree()
    markClaudeProjectTrusted(worktree)
    const path = join(testState.fakeHomeDir, '.claude.json')
    expect(readConfig(path).projects[worktree].hasTrustDialogAccepted).toBe(true)
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600)
    }
  })

  it('writes to CLAUDE_CONFIG_DIR when Claude is pointed there', () => {
    const worktree = makeWorktree()
    const configDir = join(testState.fakeHomeDir, 'claude-config')
    process.env.CLAUDE_CONFIG_DIR = configDir
    markClaudeProjectTrusted(worktree)
    expect(
      readConfig(join(configDir, '.claude.json')).projects[worktree].hasTrustDialogAccepted
    ).toBe(true)
  })

  it('leaves a config it cannot parse untouched', () => {
    const worktree = makeWorktree()
    const path = join(testState.fakeHomeDir, '.claude.json')
    writeFileSync(path, '{not json')
    markClaudeProjectTrusted(worktree)
    expect(readFileSync(path, 'utf-8')).toBe('{not json')
  })
})
