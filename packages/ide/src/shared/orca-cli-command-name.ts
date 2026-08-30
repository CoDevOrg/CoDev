// Linux used `orca-ide` to avoid colliding with GNOME Orca's `orca` package and
// /usr/bin/orca. `codev` has no such collision, so every platform can share it.
export function getOrcaCliCommandNameForPlatform(platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return 'codev.cmd'
  }
  return 'codev'
}

/** Names an older install may have registered on PATH, newest first. */
export function getLegacyOrcaCliCommandNamesForPlatform(
  platform: NodeJS.Platform
): readonly string[] {
  if (platform === 'linux') {
    return ['orca-ide']
  }
  if (platform === 'win32') {
    return ['orca.cmd']
  }
  return ['orca']
}
