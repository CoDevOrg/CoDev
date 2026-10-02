import { Pool } from "pg";
import { normalizePostgresConnectionString } from "../src/connection.ts";

const connection = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
if (!connection) {
  console.error(
    "Database configuration is missing. Set POSTGRES_URL or DATABASE_URL.",
  );
  process.exit(1);
}
const pool = new Pool({
  connectionString: normalizePostgresConnectionString(connection),
  connectionTimeoutMillis: 5000,
});
try {
  // Probe actual objects, not only migration timestamps: merged migration
  // histories can skip an older migration even when later ones are recorded.
  await pool.query(`SELECT id, workspace_id, chat_id, created_by, worktree_id,
    host_workspace_id, host_terminal_id, host_agent_session_id, provider,
    connection_id, credential_revision, status, lease_claimed, exit_reason,
    recovery_count, idempotency_key, last_error, created_at, updated_at
    FROM public.gen2_superset_runs LIMIT 0`);
  await pool.query(`SELECT id, run_id, workspace_id, actor_id, type, result, created_at
    FROM public.gen2_superset_run_events LIMIT 0`);
  await pool.query(`SELECT id, workspace_id, owner_id, started_at, ended_at, last_activity_at
    FROM public.gen2_compute_sessions LIMIT 0`);
  console.log("Superset agent storage schema is ready.");
} catch (error) {
  console.error(
    `Database schema check failed (${error.code ?? "connection_error"}). Run pnpm db:migrate against the same database before starting or deploying the app.`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
