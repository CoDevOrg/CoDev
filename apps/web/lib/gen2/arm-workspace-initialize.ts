import "server-only";

import { schema } from "@codev/db";
import { eq } from "drizzle-orm";

import { getDatabase } from "../platform/database";
import { getRepositorySnapshot } from "../github/github";
import { armWorkspaceRequest } from "../runtime/arm-workspace-request";
import { ArmWorkspaceRuntimeError } from "../runtime/arm-workspace-provider";

type Workspace = typeof schema.gen2Workspaces.$inferSelect;
type Target = Parameters<typeof armWorkspaceRequest>[0];

async function sourceFor(
  workspace: Workspace,
  db: ReturnType<typeof getDatabase>,
) {
  if (!workspace.repository || !workspace.baseSha) {
    const { buildBlankSandboxSource } = await import("./instance");
    return buildBlankSandboxSource();
  }
  if (!workspace.repositoryPrivate) {
    return {
      repositoryUrl: `https://github.com/${workspace.repository}.git`,
      baseSha: workspace.baseSha,
    };
  }
  return {
    repositoryUrl: null,
    baseSha: workspace.baseSha,
    repositorySnapshot: await getRepositorySnapshot(
      workspace.ownerId,
      workspace.repository,
      workspace.baseSha,
      db,
    ),
  };
}

async function initialize(target: Target, body: unknown) {
  const response = await armWorkspaceRequest(
    target,
    "POST",
    "/v1/workspace/initialize",
    body,
    70_000,
  );
  if (!response.ok)
    throw new ArmWorkspaceRuntimeError("WORKSPACE_INITIALIZATION_FAILED");
  return (await response.json()) as { initialized: boolean };
}

async function requireRuntimeProtocol(target: Target) {
  const response = await armWorkspaceRequest(
    target,
    "GET",
    "/v1/runtime-activity",
    undefined,
    10_000,
  );
  const payload = (await response.json()) as { running?: boolean };
  if (!response.ok || typeof payload.running !== "boolean") {
    throw new ArmWorkspaceRuntimeError("GUEST_RUNTIME_UPDATE_REQUIRED");
  }
}

/** Populate only a disk with the guest's protected new-disk authorization. */
export async function initializeGen2ArmWorkspace(
  db: ReturnType<typeof getDatabase>,
  target: Target,
) {
  await requireRuntimeProtocol(target);
  const [workspace] = await db
    .select()
    .from(schema.gen2Workspaces)
    .where(eq(schema.gen2Workspaces.id, target.workspaceId))
    .limit(1);
  if (!workspace) throw new ArmWorkspaceRuntimeError("STALE_OPERATION");
  const blank = !workspace.repository ? await sourceFor(workspace, db) : null;
  const identity = {
    repositoryUrl:
      workspace.repository && !workspace.repositoryPrivate
        ? `https://github.com/${workspace.repository}.git`
        : null,
    baseSha: workspace.baseSha ?? blank?.baseSha,
  };
  if ((await initialize(target, identity)).initialized) return;
  const source = blank ?? (await sourceFor(workspace, db));
  if ("repositorySnapshot" in source && source.repositorySnapshot) {
    for (const file of source.repositorySnapshot.files) {
      await initialize(target, { ...identity, file });
    }
  }
  await initialize(target, { ...identity, complete: true });
}
