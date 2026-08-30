import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { accessSync, constants, existsSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import {
  addClaudeTeammateModeAuto,
  addClaudeTeammateModeInProcess,
  isDirectClaudeCommand,
  type ClaudeAgentTeamsMode
} from '../../shared/claude-agent-teams-tmux-compat'
import {
  getLegacyOrcaCliCommandNamesForPlatform,
  getOrcaCliCommandNameForPlatform
} from '../../shared/orca-cli-command-name'
import { codevHomeConfigDir } from '../../shared/codev-config-dir'

export type ClaudeAgentTeamsLaunchPlan = {
  command: string
  env: Record<string, string>
  envToDelete?: string[]
}

export async function ensureClaudeAgentTeamsShimDir(root = defaultShimRoot()): Promise<string> {
  await mkdir(root, { recursive: true })
  await writeIfChanged(join(root, 'tmux'), unixShimScript())
  if (process.platform === 'win32') {
    await writeIfChanged(join(root, 'tmux.cmd'), windowsShimScript())
  }
  return root
}

export async function buildClaudeAgentTeamsLaunchPlan(args: {
  command: string | undefined
  mode: ClaudeAgentTeamsMode | undefined
  baseEnv: Record<string, string | undefined>
  createTeamEnv: (shimDir: string, shimBin: string) => Record<string, string>
}): Promise<ClaudeAgentTeamsLaunchPlan | null> {
  const mode = args.mode ?? 'off'
  if (!args.command || mode === 'off' || !isDirectClaudeCommand(args.command)) {
    return null
  }
  if (mode === 'in-process' || process.platform === 'win32') {
    return {
      command: addClaudeTeammateModeInProcess(args.command),
      env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' }
    }
  }
  const shimDir = await ensureClaudeAgentTeamsShimDir()
  const shimBin = resolveClaudeAgentTeamsShimBin(args.baseEnv)
  const env = args.createTeamEnv(shimDir, shimBin)
  return {
    command: addClaudeTeammateModeAuto(args.command),
    env,
    envToDelete: ['TERM_PROGRAM', 'ORCA_ATTRIBUTION_SHIM_DIR']
  }
}

export function resolveClaudeAgentTeamsShimBin(
  env: Record<string, string | undefined> = process.env
): string {
  if (env.ORCA_AGENT_TEAMS_SHIM_BIN) {
    return env.ORCA_AGENT_TEAMS_SHIM_BIN
  }
  const bundled = bundledLauncherPath()
  if (bundled && isExecutableFile(bundled)) {
    return bundled
  }
  const devNames =
    process.platform === 'win32' ? ['codev-dev.cmd', 'orca-dev.cmd'] : ['codev-dev', 'orca-dev']
  const candidates = [
    ...devNames,
    getOrcaCliCommandNameForPlatform(process.platform),
    ...getLegacyOrcaCliCommandNamesForPlatform(process.platform)
  ]
  for (const candidate of candidates) {
    const found = findExecutableOnPath(candidate, env.PATH)
    if (found) {
      return found
    }
  }
  return getOrcaCliCommandNameForPlatform(process.platform)
}

function defaultShimRoot(): string {
  return join(codevHomeConfigDir(), 'claude-agent-teams-bin')
}

function bundledLauncherPath(): string | null {
  if (!process.resourcesPath) {
    return null
  }
  // Why: extraResources ships the launcher under both names during the rename,
  // so prefer the CoDev one and fall back to what an older bundle laid down.
  const names =
    process.platform === 'darwin'
      ? ['codev', 'orca']
      : process.platform === 'linux'
        ? ['codev', 'orca-ide']
        : process.platform === 'win32'
          ? ['codev.exe', 'orca.exe']
          : []
  for (const name of names) {
    const candidate = join(process.resourcesPath, 'bin', name)
    if (isExecutableFile(candidate)) {
      return candidate
    }
  }
  return null
}

function findExecutableOnPath(command: string, pathValue: string | undefined): string | null {
  for (const directory of pathValue?.split(delimiter) ?? []) {
    if (!directory) {
      continue
    }
    const candidate = join(directory, command)
    if (isExecutableFile(candidate)) {
      return candidate
    }
  }
  return null
}

function isExecutableFile(candidate: string): boolean {
  try {
    if (!existsSync(candidate)) {
      return false
    }
    accessSync(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

function unixShimScript(): string {
  return [
    '#!/usr/bin/env sh',
    'set -eu',
    `exec "\${ORCA_AGENT_TEAMS_SHIM_BIN:-${getOrcaCliCommandNameForPlatform(process.platform)}}" agent-teams-tmux "$@"`,
    ''
  ].join('\n')
}

function windowsShimScript(): string {
  return [
    '@echo off',
    'setlocal',
    'if "%ORCA_AGENT_TEAMS_SHIM_BIN%"=="" (',
    `  set "ORCA_AGENT_TEAMS_SHIM_BIN=${getOrcaCliCommandNameForPlatform(process.platform)}"`,
    ')',
    '"%ORCA_AGENT_TEAMS_SHIM_BIN%" agent-teams-tmux %*',
    ''
  ].join('\r\n')
}

async function writeIfChanged(path: string, content: string): Promise<void> {
  try {
    if ((await readFile(path, 'utf8')) === content) {
      return
    }
  } catch {
    // rewrite below
  }
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  let renamed = false
  try {
    await writeFile(tmp, content, 'utf8')
    if (process.platform !== 'win32') {
      await chmod(tmp, 0o755)
    }
    await rename(tmp, path)
    renamed = true
  } finally {
    if (!renamed) {
      await rm(tmp, { force: true })
    }
  }
}
