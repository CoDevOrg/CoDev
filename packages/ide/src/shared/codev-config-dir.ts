import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CONFIG_DIR_NAME, LEGACY_CONFIG_DIR_NAME } from './codev-identifiers'

// Why: an install that already has ~/.orca keeps using it — agent hooks record
// absolute script paths in Claude/Codex config, so moving the directory would
// break hooks installed before the rename. Fresh installs get ~/.codev.
const resolved = new Map<string, string>()

/** The per-user config directory: ~/.codev, or an existing ~/.orca. */
export function codevHomeConfigDir(home: string = homedir()): string {
  const cached = resolved.get(home)
  if (cached !== undefined) {
    return cached
  }
  const legacy = join(home, LEGACY_CONFIG_DIR_NAME)
  const dir =
    !existsSync(join(home, CONFIG_DIR_NAME)) && existsSync(legacy)
      ? legacy
      : join(home, CONFIG_DIR_NAME)
  resolved.set(home, dir)
  return dir
}

/** Test-only: drop memoized lookups so a fresh temp HOME resolves again. */
export function resetCodevHomeConfigDirCache(): void {
  resolved.clear()
}
