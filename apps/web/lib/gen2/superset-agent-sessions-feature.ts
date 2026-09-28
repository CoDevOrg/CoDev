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
