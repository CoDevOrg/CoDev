import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Member processes use distinct uids and need execute-only traversal through
 * the shared parent to reach their own 0700 home without listing other homes.
 */
export function ensureMemberProfilesRoot(memberHomeRoot: string) {
	// systemd creates StateDirectory paths with the configured private mode,
	// including on existing guests. The host service runs as root and opens
	// traversal here only after separating member homes from its private DB.
	mkdirSync(memberHomeRoot, { recursive: true, mode: 0o711 });
	chmodSync(memberHomeRoot, 0o711);
	const profilesRoot = join(memberHomeRoot, "codev-members");
	mkdirSync(profilesRoot, { recursive: true, mode: 0o711 });
	chmodSync(profilesRoot, 0o711);
	return profilesRoot;
}
