import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import { parseWslUncPath } from '../shared/wsl-paths'
import { resolveCliCommand } from './codex-cli/command'
import {
  getLauncherBaseName,
  hasMatchingOuterQuotes,
  stripMatchingQuotes
} from './editor-launcher-name'
import { getCmdExePath, getSpawnArgsForWindows } from './win32-utils'

const VSCODE_LAUNCHER_NAMES = new Set(['code', 'code-insiders', 'code - insiders'])

function isVsCodeLauncherExecutable(command: string): boolean {
  const unquoted = stripMatchingQuotes(command)
  const fileName = unquoted.split(/[\\/]/).at(-1) ?? ''
  const launcherName = fileName.replace(/\.(?:cmd|exe|bat)$/i, '').toLowerCase()
  return VSCODE_LAUNCHER_NAMES.has(launcherName)
}

export const EXTERNAL_EDITOR_CLI_COMMAND = 'code'
const WINDOWS_CONSOLE_EDITORS = new Set(['nvim', 'vim'])

export type ExternalEditorExecutableLaunchSpec = {
  kind: 'executable'
  hideWindowsConsole: boolean
  spawnCmd: string
  spawnArgs: string[]
}

export type ExternalEditorShellLaunchSpec = {
  kind: 'shell'
  hideWindowsConsole: boolean
  spawnCmd: string
  spawnArgs: string[]
}

export type ExternalEditorLaunchSpec =
  | ExternalEditorExecutableLaunchSpec
  | ExternalEditorShellLaunchSpec

function escapePosixPathForShell(pathValue: string): string {
  if (/^[a-zA-Z0-9_./@:-]+$/.test(pathValue)) {
    return pathValue
  }
  return `'${pathValue.replace(/'/g, "'\\''")}'`
}

function escapeWindowsPathForShell(pathValue: string): string {
  return /^[a-zA-Z0-9_./@:\\-]+$/.test(pathValue) ? pathValue : `"${pathValue}"`
}

function escapePathForShell(pathValue: string, platform: NodeJS.Platform): string {
  return platform === 'win32'
    ? escapeWindowsPathForShell(pathValue)
    : escapePosixPathForShell(pathValue)
}

function isWindowsExecutablePath(command: string): boolean {
  return win32.isAbsolute(command) && /\.(?:cmd|exe|bat|com)$/i.test(command)
}

function isDirectExecutablePath(
  command: string,
  platform: NodeJS.Platform,
  fileExists: (path: string) => boolean
): boolean {
  const unquoted = stripMatchingQuotes(command)
  if (!/[\\/]/.test(unquoted)) {
    return false
  }
  const isAbsolutePath =
    platform === 'win32' ? win32.isAbsolute(unquoted) : posix.isAbsolute(unquoted)
  if (!isAbsolutePath) {
    return false
  }
  if (!/\s/.test(unquoted) || hasMatchingOuterQuotes(command)) {
    return true
  }
  // Why: unquoted POSIX paths can contain spaces, but so can shell commands
  // with arguments. Only an existing path is safe to treat as one executable.
  return platform === 'win32' ? isWindowsExecutablePath(unquoted) : fileExists(unquoted)
}

function shouldShowWindowsConsole(
  command: string,
  platform: NodeJS.Platform,
  options: { shellCommand?: boolean } = {}
): boolean {
  return platform === 'win32' && WINDOWS_CONSOLE_EDITORS.has(getLauncherBaseName(command, options))
}

function buildExecutableArgs(
  editorCommand: string,
  pathValue: string,
  platform: NodeJS.Platform
): string[] {
  const launcherBaseName = getLauncherBaseName(editorCommand)
  if (launcherBaseName === 'cursor') {
    // Why: Cursor can route bare folder launches through the last active
    // workbench. A new window keeps "Open in Cursor" scoped to this worktree.
    return ['--new-window', pathValue]
  }
  if (platform === 'win32' && isVsCodeLauncherExecutable(editorCommand)) {
    const wslPath = parseWslUncPath(pathValue)
    if (wslPath) {
      // Why: VS Code otherwise treats a WSL UNC path as a local Windows folder.
      return ['--remote', `wsl+${wslPath.distro}`, wslPath.linuxPath]
    }
  }
  return [pathValue]
}

function isCompoundShellCommand(command: string): boolean {
  return /\s/.test(command)
}

function resolveSimpleEditorCommand(command: string, platform: NodeJS.Platform): string {
  return resolveCliCommand(command, { platform })
}

function buildExecutableLaunchSpec(
  editorCommand: string,
  pathValue: string,
  platform: NodeJS.Platform
): ExternalEditorExecutableLaunchSpec {
  const spec: ExternalEditorExecutableLaunchSpec = {
    kind: 'executable',
    hideWindowsConsole: !shouldShowWindowsConsole(editorCommand, platform),
    spawnCmd: editorCommand,
    spawnArgs: buildExecutableArgs(editorCommand, pathValue, platform)
  }
  return spec
}

function buildShellLaunchSpec(
  command: string,
  pathValue: string,
  platform: NodeJS.Platform
): ExternalEditorLaunchSpec {
  const shellCommand = `${command} ${escapePathForShell(pathValue, platform)}`
  if (platform === 'win32') {
    // Why: no `start` wrap here. `start` re-parses the line — it swallows the
    // first quoted operand as a window title and mangles remote paths with
    // spaces — and on a batch target it leaves a resident nested `cmd /K`.
    // User-authored compound commands run verbatim; users who want a detached
    // launch already write `start` themselves.
    return {
      kind: 'shell',
      hideWindowsConsole: !shouldShowWindowsConsole(command, platform, { shellCommand: true }),
      spawnCmd: getCmdExePath(),
      spawnArgs: ['/d', '/s', '/c', shellCommand]
    }
  }
  return {
    kind: 'shell',
    hideWindowsConsole: true,
    spawnCmd: '/bin/sh',
    spawnArgs: ['-c', shellCommand]
  }
}

export function resolveExternalEditorLaunchSpec(
  command: string | undefined,
  pathValue: string,
  options: { platform?: NodeJS.Platform; fileExists?: (path: string) => boolean } = {}
): ExternalEditorLaunchSpec {
  const platform = options.platform ?? process.platform
  const fileExists = options.fileExists ?? existsSync
  const trimmed = command?.trim() || EXTERNAL_EDITOR_CLI_COMMAND

  if (isDirectExecutablePath(trimmed, platform, fileExists)) {
    return buildExecutableLaunchSpec(stripMatchingQuotes(trimmed), pathValue, platform)
  }

  if (isCompoundShellCommand(trimmed)) {
    return buildShellLaunchSpec(trimmed, pathValue, platform)
  }

  return buildExecutableLaunchSpec(resolveSimpleEditorCommand(trimmed, platform), pathValue, platform)
}

function resolveExternalEditorSpawn(launchSpec: ExternalEditorLaunchSpec): {
  spawnCmd: string
  spawnArgs: string[]
  windowsHide: boolean
} {
  if (launchSpec.kind === 'executable') {
    const spawned = getSpawnArgsForWindows(launchSpec.spawnCmd, launchSpec.spawnArgs)
    return { ...spawned, windowsHide: launchSpec.hideWindowsConsole }
  }
  return {
    spawnCmd: launchSpec.spawnCmd,
    spawnArgs: launchSpec.spawnArgs,
    windowsHide: launchSpec.hideWindowsConsole
  }
}

export async function launchExternalEditor(launchSpec: ExternalEditorLaunchSpec): Promise<void> {
  const { spawnCmd, spawnArgs, windowsHide } = resolveExternalEditorSpawn(launchSpec)
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(spawnCmd, spawnArgs, { detached: true, stdio: 'ignore', windowsHide })
    let settled = false
    function cleanup(): void {
      child.off('error', onError)
      child.off('spawn', onSpawn)
    }
    function settle(callback: () => void): void {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      callback()
    }
    function onError(error: Error): void {
      settle(() => rejectPromise(error))
    }
    function onSpawn(): void {
      child.unref()
      settle(resolvePromise)
    }
    child.once('error', onError)
    child.once('spawn', onSpawn)
  })
}
