/** The guest image reserves uid/gid 2000 for codev-shell, the terminal account. */
const CODEV_SHELL_ID = 2000;

/**
 * On a CoDev guest the host service runs as root, but every workspace member
 * and agent can write the shared repository's Git config and attributes. Git
 * runs commands those files name (fsmonitor, filters, diff drivers, hooks), so
 * repository Git must run as codev-shell: it then gains nothing a terminal
 * does not already have. Elsewhere this is a no-op.
 */
export function workspaceGitSpawnOptions(): { uid?: number; gid?: number } {
	return process.getuid?.() === 0 && process.env.CODEV_WORKSPACE_ROOT
		? { uid: CODEV_SHELL_ID, gid: CODEV_SHELL_ID }
		: {};
}
