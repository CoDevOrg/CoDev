import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { writeFileAtomically } from './codex-accounts/fs-utils'
import { getOrcaManagedCodexHomePath } from './codex/codex-home-paths'
import { upsertProjectTrustLevel } from './codex/config-toml-trust'

export type AgentTrustPreset = 'claude' | 'codex'

/**
 * Pre-mark a workspace as trusted for Claude Code or Codex so the agent's
 * "Do you trust this folder?" menu does not fire on first launch.
 *
 * Why: Orca's "drop URL into agent input as a draft" flow injects the URL
 * via bracketed-paste once the TUI is up. If the trust menu intercepts the
 * keystrokes (each menu reads a single character or numbered option), the
 * paste either selects an arbitrary option or quits the session. Pre-writing
 * the same trust artifacts that the agent writes after the user accepts is
 * the only documented bypass — both CLIs read these files at startup before
 * showing the menu.
 *
 * Side note: Codex's `--dangerously-bypass-approvals-and-sandbox` would also
 * change approval/sandbox policy, so it is not equivalent to "trust this project".
 */

/**
 * Claude Code keeps per-project trust in its global config — `~/.claude.json`,
 * or `$CLAUDE_CONFIG_DIR/.claude.json` — under
 * `projects["<path>"].hasTrustDialogAccepted`. Its lookup walks parents only up
 * to the checkout root (verified against the Claude Code 2.1.270 bundle), so a
 * trusted repo does not cover a sibling agent worktree: each needs its own entry.
 */
export function markClaudeProjectTrusted(workspacePath: string): void {
  const absPath = canonicalize(workspacePath)
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || homedir()
  const configPath = join(configDir, '.claude.json')
  let config: Record<string, unknown> = {}
  try {
    if (existsSync(configPath)) {
      const parsed: unknown = JSON.parse(readFileSync(configPath, 'utf-8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return
      }
      config = parsed as Record<string, unknown>
    }
  } catch {
    // Why: never replace a config Claude itself could not parse; the prompt still works manually.
    return
  }
  const projects = isPlainObject(config.projects) ? config.projects : {}
  const entry = projects[absPath]
  const existing = isPlainObject(entry) ? entry : {}
  if (existing.hasTrustDialogAccepted === true) {
    return
  }
  config.projects = { ...projects, [absPath]: { ...existing, hasTrustDialogAccepted: true } }
  mkdirSync(configDir, { recursive: true })
  // Why: this file carries MCP bearer tokens; keep it owner-only like Claude does.
  writeFileAtomically(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Codex stores project trust in ~/.codex/config.toml under:
 *   [projects."<realpath>"]
 *   trust_level = "trusted"
 *
 * Verified against codex-rs/tui/src/onboarding/trust_directory.rs and
 * codex-rs/core/src/config/config_tests.rs in the Codex CLI source.
 */
export function markCodexProjectTrusted(workspacePath: string): void {
  const absPath = resolveCodexProjectTrustRoot(workspacePath)
  const configPath = join(homedir(), '.codex', 'config.toml')
  upsertProjectTrustLevel(configPath, absPath, 'trusted')
  // Why: Orca-launched Codex runs with an Orca-owned CODEX_HOME, so the trust
  // preset must also update the runtime config Codex will actually read.
  upsertProjectTrustLevel(join(getOrcaManagedCodexHomePath(), 'config.toml'), absPath, 'trusted')
}

function resolveCodexProjectTrustRoot(workspacePath: string): string {
  const absPath = canonicalize(workspacePath)
  try {
    const gitDirReference = readFileSync(join(absPath, '.git'), 'utf-8').trim()
    if (!gitDirReference.startsWith('gitdir:')) {
      return absPath
    }
    const gitDirPath = gitDirReference.slice('gitdir:'.length).trim()
    if (!gitDirPath) {
      return absPath
    }
    const gitDir = resolve(absPath, gitDirPath)
    const worktreesDir = dirname(gitDir)
    if (basename(worktreesDir) !== 'worktrees') {
      return absPath
    }
    // Why: workspace-controlled .git metadata must not broaden trust without Git's reciprocal link.
    const gitDirBacklink = readFileSync(join(gitDir, 'gitdir'), 'utf-8').trim()
    if (!gitDirBacklink) {
      return absPath
    }
    const resolvedBacklink = resolve(gitDir, gitDirBacklink)
    const workspaceGitFile = join(absPath, '.git')
    if (
      resolvedBacklink !== workspaceGitFile &&
      canonicalize(resolvedBacklink) !== canonicalize(workspaceGitFile)
    ) {
      return absPath
    }
    // Why: mirror Codex's validated .git/worktrees/<name> traversal instead of trusting arbitrary commondir contents.
    return canonicalize(dirname(dirname(worktreesDir)))
  } catch {
    return absPath
  }
}

function canonicalize(p: string): string {
  // Why: macOS reports `/tmp/x` and `/private/tmp/x` as the same inode, and
  // the agents' trust comparators run realpath() before the string compare.
  // Mirror that so a worktree under a symlinked parent (orca caches
  // realpath()'d worktree paths) matches the agent's lookup.
  try {
    if (existsSync(p)) {
      return realpathSync.native(p)
    }
  } catch {
    // Fall through to the raw input.
  }
  return p
}

