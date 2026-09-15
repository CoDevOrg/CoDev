import { mkdtempSync, rmSync, } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareLocalCommitMessageAgentEnv } from './commit-message-agent-environment'

const originalEnv = { ...process.env }
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
const tempDirs: string[] = []

afterEach(() => {
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform)
  }
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, originalEnv)
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

function makeHome(): string {
  Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
  const dir = mkdtempSync(join(tmpdir(), 'orca-commit-env-'))
  tempDirs.push(dir)
  process.env.HOME = dir
  process.env.SHELL = '/bin/zsh'
  delete process.env.ORCA_OPENCODE_SOURCE_CONFIG_DIR
  delete process.env.ORCA_PI_SOURCE_AGENT_DIR
  return dir
}

describe('prepareLocalCommitMessageAgentEnv', () => {

  it('does not synthesize env for agents without shell-scoped auth or config roots', async () => {
    makeHome()

    await expect(prepareLocalCommitMessageAgentEnv('cursor', undefined)).resolves.toEqual({
      ok: true
    })
  })

  it('falls back to inherited env when managed account resolvers are unavailable', async () => {
    await expect(prepareLocalCommitMessageAgentEnv('codex', undefined)).resolves.toEqual({
      ok: true
    })
    await expect(prepareLocalCommitMessageAgentEnv('claude', undefined)).resolves.toEqual({
      ok: true
    })
  })

  it('sets CODEX_HOME for host managed Codex accounts', async () => {
    const result = await prepareLocalCommitMessageAgentEnv('codex', {
      prepareForCodexLaunch: () =>
        'C:\\Users\\tester\\AppData\\Roaming\\Orca\\codex-accounts\\a\\home'
    })

    expect(result).toEqual({
      ok: true,
      env: expect.objectContaining({
        CODEX_HOME: 'C:\\Users\\tester\\AppData\\Roaming\\Orca\\codex-accounts\\a\\home'
      })
    })
  })

  it('strips a nested-Orca CODEX_HOME override when the launch resolves to the real home', async () => {
    process.env.CODEX_HOME = '/managed/runtime/home'
    process.env.ORCA_CODEX_HOME = '/managed/runtime/home'

    const result = await prepareLocalCommitMessageAgentEnv('codex', {
      prepareForCodexLaunch: () => null
    })

    expect(result.ok).toBe(true)
    const env = (result as { ok: true; env?: NodeJS.ProcessEnv }).env
    expect(env).toBeDefined()
    expect(env?.CODEX_HOME).toBeUndefined()
    expect(env?.ORCA_CODEX_HOME).toBeUndefined()
  })

  it('preserves a user-owned CODEX_HOME when the launch resolves to the real home', async () => {
    process.env.CODEX_HOME = '/home/me/.config/codex'
    delete process.env.ORCA_CODEX_HOME

    const result = await prepareLocalCommitMessageAgentEnv('codex', {
      prepareForCodexLaunch: () => null
    })

    expect(result.ok).toBe(true)
    const env = (result as { ok: true; env?: NodeJS.ProcessEnv }).env
    expect(env?.CODEX_HOME).toBe('/home/me/.config/codex')
  })

  it('does not pass WSL managed Codex homes to host-local commit generation', async () => {
    process.env.CODEX_HOME = 'C:\\Users\\tester\\.codex'

    const result = await prepareLocalCommitMessageAgentEnv('codex', {
      prepareForCodexLaunch: () =>
        '\\\\wsl.localhost\\Ubuntu\\home\\tester\\.local\\share\\orca\\codex-accounts\\a\\home'
    })

    expect(result).toEqual({ ok: true })
  })

  it('passes WSL managed Codex homes as Linux paths for WSL-local commit generation', async () => {
    const result = await prepareLocalCommitMessageAgentEnv(
      'codex',
      {
        prepareForCodexLaunch: (target) => {
          expect(target).toEqual({ runtime: 'wsl', wslDistro: 'Ubuntu' })
          return '\\\\wsl.localhost\\Ubuntu\\home\\tester\\.codex'
        }
      },
      { runtime: 'wsl', wslDistro: 'Ubuntu' }
    )

    expect(result).toEqual({
      ok: true,
      env: expect.objectContaining({
        CODEX_HOME: '/home/tester/.codex'
      })
    })
  })

  it('does not hydrate host shell config roots for WSL-local commit generation', async () => {
    process.env.OPENCODE_CONFIG_DIR = 'C:\\Users\\tester\\opencode'

    const result = await prepareLocalCommitMessageAgentEnv('opencode', undefined, {
      runtime: 'wsl',
      wslDistro: 'Ubuntu'
    })

    expect(result).toEqual({ ok: true })
  })
})
