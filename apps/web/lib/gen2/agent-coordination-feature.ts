import "server-only";

/**
 * Agent coordination rolls out per workspace: a comma-separated list of
 * workspace IDs, or `*` for every workspace. Unset means off. Agent starts
 * carry the decision to the guest, which installs or registers coordination
 * hooks only for those launches — docs/SUPERSET_AGENT_COORDINATION.md.
 */
export function isGen2AgentCoordinationEnabled(workspaceId: string) {
  const workspaces = (process.env.CODEV_AGENT_COORDINATION_WORKSPACES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return workspaces.includes("*") || workspaces.includes(workspaceId);
}
