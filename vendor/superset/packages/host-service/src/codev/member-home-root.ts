import { chmodSync, mkdirSync } from "node:fs";

/**
 * Member processes use distinct uids and need execute-only traversal through
 * the shared parent to reach their own 0700 home without listing other homes.
 */
export function ensureMemberProfilesRoot(path: string) {
	mkdirSync(path, { recursive: true, mode: 0o711 });
	chmodSync(path, 0o711);
}
