import "server-only";

/**
 * Terminal-agent sessions launched through Superset, replacing the direct
 * `codex exec` orchestrator path -- docs/SUPERSET_AGENT_SESSION_PLAN.md.
 * Kept independent of `CODEV_SUPERSET_RUNTIME_ENABLED` (the terminal/Git/
 * worktree bridge flag in `superset-runtime-feature.ts`) so the two migrate
 * on separate schedules, per the plan's Phase 3.
 */
export function isGen2SupersetAgentSessionsEnabled() {
  return process.env.CODEV_SUPERSET_AGENT_SESSIONS_ENABLED === "true";
}

/**
 * Cursor joins Superset agent sessions only when every running guest has a
 * host service that accepts it (ARM image 1.0.17 or later); an older host
 * rejects the provider. Until then Cursor keeps the native guest path.
 */
export function isGen2SupersetCursorAgentsEnabled() {
  return (
    isGen2SupersetAgentSessionsEnabled() &&
    process.env.CODEV_SUPERSET_CURSOR_AGENTS_ENABLED === "true"
  );
}

const SUPERSET_RUN_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A turn's path is fixed when it starts: Superset turns are keyed by their
 * run's UUID, native guest turns by the guest's own session ID. Routing on
 * that, not the provider, keeps in-flight turns on the path that started them.
 */
export function isGen2SupersetTurn(sessionId: string) {
  return (
    isGen2SupersetAgentSessionsEnabled() && SUPERSET_RUN_ID.test(sessionId)
  );
}
