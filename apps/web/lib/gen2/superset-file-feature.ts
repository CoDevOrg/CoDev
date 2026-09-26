/**
 * This migration surface is deliberately dark until the backend adapter and
 * collaboration binding are ready for broader testing.
 */
export function isGen2SupersetFilePaneEnabled() {
  return process.env.CODEV_SUPERSET_FILE_PANE_ENABLED === "true";
}
