import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AiVaultScanIssue } from '../../shared/ai-vault-types'
import { uniqueCodexSessionsDirs } from './session-scanner-codex-paths'
import { SUBAGENT_DIR_NAME } from './session-scanner-subagent-transcripts'
import { discoverFiles } from './session-scanner-discovery'
import type { AiVaultScanOptions, SessionFileDiscovery } from './session-scanner-types'
import { claudeProjectsRootDirs, normalizedWslHomeDirs } from './session-scanner-roots'

export const DEFAULT_CODEX_HOME_DIR = join(homedir(), '.codex')
const CODEX_HOME_DIR = process.env.CODEX_HOME?.trim() || DEFAULT_CODEX_HOME_DIR
const CODEX_SESSIONS_DIR = join(CODEX_HOME_DIR, 'sessions')

export async function discoverAiVaultSessionSources(args: {
  options: AiVaultScanOptions
  limitPerAgent: number
  issues: AiVaultScanIssue[]
}): Promise<SessionFileDiscovery[]> {
  const { options, limitPerAgent, issues } = args
  const wslHomeDirs = normalizedWslHomeDirs(options.wslHomeDirs)
  const codexSessionsDirs = uniqueCodexSessionsDirs([
    options.codexSessionsDir ?? CODEX_SESSIONS_DIR,
    ...wslHomeDirs.map((homeDir) => join(homeDir, '.codex', 'sessions')),
    // Why: Orca-launched WSL Codex sessions use an Orca-owned CODEX_HOME,
    // not the user's default ~/.codex history root.
    ...wslHomeDirs.map((homeDir) =>
      join(homeDir, '.local', 'share', 'orca', 'codex-runtime-home', 'home', 'sessions')
    ),
    ...(options.additionalCodexSessionsDirs ?? [])
  ])

  return Promise.all([
    ...claudeDiscoveries(options, wslHomeDirs, limitPerAgent, issues),
    ...codexDiscoveries(codexSessionsDirs, limitPerAgent, issues)
  ])
}

function claudeDiscoveries(
  options: AiVaultScanOptions,
  wslHomeDirs: readonly string[],
  limit: number,
  issues: AiVaultScanIssue[]
): Promise<SessionFileDiscovery>[] {
  return claudeProjectsRootDirs({
    claudeProjectsDir: options.claudeProjectsDir,
    wslHomeDirs
  }).map((rootDir) =>
    discoverFiles({
      rootDir,
      limit,
      agent: 'claude',
      issues,
      extensions: ['.jsonl'],
      // Why: Task subagent transcripts under `<session>/subagents/` share the parent
      // sessionId and aren't independently resumable, so they'd just duplicate the
      // parent as untitled rows; prune the subtree and read them on demand under
      // their parent instead.
      directoryPredicate: (name) => name !== SUBAGENT_DIR_NAME
    })
  )
}

function codexDiscoveries(
  rootDirs: readonly string[],
  limit: number,
  issues: AiVaultScanIssue[]
): Promise<SessionFileDiscovery>[] {
  return rootDirs.map((rootDir) =>
    discoverFiles({ rootDir, limit, agent: 'codex', issues, extensions: ['.jsonl'] })
  )
}
