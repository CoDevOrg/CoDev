import { Gen2AccessError, Gen2LifecycleError } from "./errors";
import { getGen2SupersetRunById } from "./superset-runs";
import { requireGen2Member } from "./workspaces";

type Action =
  | "list"
  | "inspect"
  | "start"
  | "input"
  | "poll"
  | "cancel"
  | "recover";
type RunAction = Exclude<Action, "list" | "inspect" | "start">;
type AccessInput = {
  action: Action;
  workspaceId: string;
  userId: string;
  runId?: string;
};
type Run = NonNullable<Awaited<ReturnType<typeof getGen2SupersetRunById>>>;

/** Recheck membership and authorize a persistent-agent operation before host access. */
export function requireGen2SupersetAgentAccess(
  input: AccessInput & { action: RunAction; runId: string },
): Promise<Run>;
export function requireGen2SupersetAgentAccess(
  input: AccessInput,
): Promise<Run | null>;
export async function requireGen2SupersetAgentAccess(input: AccessInput) {
  const member = await requireGen2Member(input.workspaceId, input.userId);
  if (input.action === "start") {
    if (member.role === "viewer") {
      throw new Gen2AccessError(
        "Only owners and editors can start agents.",
        403,
      );
    }
    return null;
  }
  if (input.action === "list" || input.action === "inspect") {
    if (!input.runId) return null;
    const run = await getGen2SupersetRunById(input.runId);
    if (!run || run.workspaceId !== input.workspaceId) {
      throw new Gen2LifecycleError("Superset run not found.", 404);
    }
    return run;
  }

  const run = input.runId ? await getGen2SupersetRunById(input.runId) : null;
  if (!run || run.workspaceId !== input.workspaceId) {
    throw new Gen2LifecycleError("Superset run not found.", 404);
  }
  const creator = run.createdBy === input.userId;
  const allowed =
    input.action === "cancel"
      ? creator || member.role === "owner"
      : creator && member.role !== "viewer";
  if (!allowed) {
    throw new Gen2LifecycleError("Superset run not found.", 404);
  }
  return run;
}
