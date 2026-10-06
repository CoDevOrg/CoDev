import "server-only";

/**
 * The file bridge and the broader Superset runtime migrate independently.
 * Production remains opt-in while local development exercises the complete
 * workspace surface against the configured guest.
 */
export function isGen2SupersetRuntimeEnabled() {
  const override = process.env.CODEV_SUPERSET_RUNTIME_ENABLED;
  if (override === "true") return true;
  if (override === "false") return false;
  return process.env.NODE_ENV === "development";
}
