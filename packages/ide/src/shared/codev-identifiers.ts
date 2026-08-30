// CoDev's user-facing config names, plus the upstream Orca names they replaced.
// Reads accept both so an existing install keeps working untouched; writes and
// display always use the CoDev name.

/** Per-repo project config, tracked in the repository. */
export const PROJECT_CONFIG_FILENAME = 'codev.yaml'
export const LEGACY_PROJECT_CONFIG_FILENAME = 'orca.yaml'

/** Per-user config directory under $HOME, and the per-repo override directory. */
export const CONFIG_DIR_NAME = '.codev'
export const LEGACY_CONFIG_DIR_NAME = '.orca'

/** Plugin manifest at a plugin root. */
export const PLUGIN_MANIFEST_FILENAME = 'codev-plugin.json'
export const LEGACY_PLUGIN_MANIFEST_FILENAME = 'orca-plugin.json'

/** Pairing deep-link scheme. */
export const PAIRING_URL_SCHEME = 'codev'
export const LEGACY_PAIRING_URL_SCHEME = 'orca'

export const PROJECT_CONFIG_FILENAMES = [
  PROJECT_CONFIG_FILENAME,
  LEGACY_PROJECT_CONFIG_FILENAME
] as const

export const PLUGIN_MANIFEST_FILENAMES = [
  PLUGIN_MANIFEST_FILENAME,
  LEGACY_PLUGIN_MANIFEST_FILENAME
] as const

/** Both accepted pairing prefixes, CoDev's first. */
export const PAIRING_URL_PREFIXES = [
  `${PAIRING_URL_SCHEME}://`,
  `${LEGACY_PAIRING_URL_SCHEME}://`
] as const

/**
 * Pick the config name to read, given which candidates exist. Prefers the CoDev
 * name, falls back to the legacy one only when it is the one actually present,
 * and otherwise returns the CoDev name so fresh state is written CoDev-native.
 */
export function preferExistingName<T extends string>(
  candidates: readonly T[],
  exists: (name: T) => boolean
): T {
  return candidates.find(exists) ?? candidates[0]
}
