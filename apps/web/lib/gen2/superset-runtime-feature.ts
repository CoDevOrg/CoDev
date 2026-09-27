import "server-only";

/**
 * The file bridge and the broader Superset runtime migrate independently.
 * Keep terminal/Git/worktree replacement opt-in until it has passed a real
 * workspace acceptance run and the old guest endpoints can be retired.
 */
export function isGen2SupersetRuntimeEnabled() {
  return process.env.CODEV_SUPERSET_RUNTIME_ENABLED === "true";
}
