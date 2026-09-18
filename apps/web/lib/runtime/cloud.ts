import "server-only";

/**
 * Lifecycle state for the runtime host.
 *
 * These are EC2's state names, inherited from when the runtime ran there and
 * kept because every consumer already branches on `"running"`, `"stopped"`
 * and `"stopping"` (see readiness.ts, runtime-resume.ts and the orchestrator
 * health route). Azure's power states map onto them cleanly in
 * `azure-host.ts`, so renaming would touch all of it to gain nothing.
 */
export type HostState =
  | "pending"
  | "running"
  | "shutting-down"
  | "stopped"
  | "stopping"
  | "terminated";
