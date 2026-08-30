/**
 * Why: a repo reached over SSH runs the Orca CLI through the relay shim, which
 * is always deployed as plain `orca` (Unix) / `orca.cmd` (Windows). The
 * Linux-only `codev` rename — which exists solely to avoid shadowing the
 * GNOME Orca screen reader on a local desktop — must not be applied to those
 * remotes, or `codev claude-teams` lands on a PATH where it does not exist.
 * `connectionId` is the SSH signal; WSL and local stay false.
 */
export function repoIsRemote(repo: { connectionId?: string | null }): boolean {
  return Boolean(repo.connectionId)
}
