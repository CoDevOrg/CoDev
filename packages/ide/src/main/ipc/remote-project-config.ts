import { PROJECT_CONFIG_FILENAMES } from '../../shared/codev-identifiers'
import type { IFilesystemProvider } from '../providers/types'
import { joinWorktreeRelativePath } from '../runtime/runtime-relative-paths'

/**
 * Read a repo's project config over a remote filesystem provider, preferring
 * codev.yaml and falling back to a legacy orca.yaml. A remote worktree can't be
 * stat'd locally, so each candidate is simply attempted in turn. Throws the last
 * error when none is readable, so callers keep their existing "no config"
 * handling.
 */
export async function readFirstProjectConfig(
  fsProvider: IFilesystemProvider,
  repoPath: string
): Promise<Awaited<ReturnType<IFilesystemProvider['readFile']>>> {
  let lastError: unknown
  for (const filename of PROJECT_CONFIG_FILENAMES) {
    try {
      return await fsProvider.readFile(joinWorktreeRelativePath(repoPath, filename))
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}
