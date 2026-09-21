import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { schema } from "@codev/db";
import type { Gen2WorkspaceStatus } from "@codev/contracts";

import { getDatabase } from "../platform/database";
import { logEvent } from "../platform/observability";
import { ensureHostReady } from "../runtime/orchestrator-health";
import { OrchestratorError } from "../runtime/orchestrator-request";
import {
  destroySandbox,
  getSandbox,
  provisionSandbox,
} from "../runtime/orchestrator-sandbox";
import { getRepositorySnapshot } from "../github/github";
import { Gen2AccessError, Gen2LifecycleError } from "./errors";
import { requireGen2Member } from "./workspaces";

/** Orchestrator create validation requires a 40-character hex SHA. */
export const GEN2_BLANK_BASE_SHA = "0".repeat(40);

/**
 * The orchestrator rejects any lifecycle other than a four-hour pause with
 * auto-resume. Copied here so gen2 does not import the gen1 hibernation module.
 */
export const GEN2_SANDBOX_LIFECYCLE = {
  timeoutMs: 4 * 60 * 60 * 1000,
  lifecycle: { onTimeout: "pause" as const, autoResume: true as const },
};

const BLANK_README = "This is a CoDev workspace.\n";

export function buildBlankSandboxSource() {
  return {
    repositoryUrl: null,
    repositorySnapshot: {
      files: [
        {
          path: "README.md",
          mode: "100644" as const,
          contentBase64: Buffer.from(BLANK_README).toString("base64"),
        },
      ],
      totalBytes: Buffer.byteLength(BLANK_README),
    },
    baseSha: GEN2_BLANK_BASE_SHA,
  };
}

export function canStopInstance(status: Gen2WorkspaceStatus) {
  return status === "ready" || status === "provisioning";
}

const HOST_UNREACHABLE_MESSAGE =
  "The Firecracker host could not be reached. Wait a few seconds and reload.";

/** Firecracker create can outlast the default 70s orchestrator timeout. */
const GEN2_PROVISION_TIMEOUT_MS = 120_000;
/** Keep expiry inside the orchestrator's exclusive four-hour window. */
const GEN2_EXPIRES_SLACK_MS = 60_000;

export function describeGen2RuntimeFailure(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    parts.push(current.message);
    current = current.cause;
  }
  if (
    /fetch failed|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|UND_ERR|aborted/i.test(
      parts.join(" "),
    )
  ) {
    return HOST_UNREACHABLE_MESSAGE;
  }
  const message = error instanceof Error ? error.message.trim() : "";
  return message || "The Firecracker instance could not start.";
}

/**
 * Where a new machine's files come from. Public repositories are cloned by
 * the orchestrator host from a plain URL; private ones are fetched by the
 * control plane with the member's GitHub token and shipped as a bounded,
 * credential-free snapshot. Either way no GitHub credential enters the guest.
 */
export async function buildGen2SandboxSource(
  userId: string,
  repository: { fullName: string; private: boolean } | null,
  baseSha: string | null,
) {
  if (!repository || !baseSha) return buildBlankSandboxSource();
  if (!repository.private) {
    return {
      repositoryUrl: `https://github.com/${repository.fullName}.git`,
      baseSha,
    };
  }
  return {
    repositoryUrl: null,
    repositorySnapshot: await getRepositorySnapshot(
      userId,
      repository.fullName,
      baseSha,
    ),
    baseSha,
  };
}

export type Gen2SandboxRuntime = {
  provision(workspaceId: string, expiresAt: Date): Promise<{ id: string }>;
  destroy(workspaceId: string): Promise<void>;
  current?(workspaceId: string): Promise<{ id: string } | null>;
};

export function createFirecrackerRuntime(
  source: Awaited<
    ReturnType<typeof buildGen2SandboxSource>
  > = buildBlankSandboxSource(),
): Gen2SandboxRuntime {
  return {
    async current(workspaceId) {
      try {
        const sandbox = await getSandbox(workspaceId);
        return { id: sandbox.id };
      } catch (error) {
        if (error instanceof OrchestratorError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
    async provision(workspaceId, expiresAt) {
      const sandbox = await provisionSandbox(
        {
          workspaceId,
          ...source,
          expiresAt: expiresAt.toISOString(),
          resumeFromSnapshot: false,
          lifecycle: GEN2_SANDBOX_LIFECYCLE,
        },
        GEN2_PROVISION_TIMEOUT_MS,
      );
      return { id: sandbox.id };
    },
    destroy(workspaceId) {
      return destroySandbox(workspaceId);
    },
  };
}

/** The create-time commit; kept off the membership view as it is internal. */
async function readGen2BaseSha(workspaceId: string) {
  const [row] = await getDatabase()
    .select({ baseSha: schema.gen2Workspaces.baseSha })
    .from(schema.gen2Workspaces)
    .where(eq(schema.gen2Workspaces.id, workspaceId))
    .limit(1);
  return row?.baseSha ?? null;
}

async function writeGen2Instance(
  workspaceId: string,
  values: {
    status: Gen2WorkspaceStatus;
    sandboxId?: string | null;
    lastError: string | null;
  },
) {
  await getDatabase()
    .update(schema.gen2Workspaces)
    .set({
      ...values,
      updatedAt: new Date(),
    })
    .where(eq(schema.gen2Workspaces.id, workspaceId));
}

/**
 * Claims the right to provision, atomically.
 *
 * Two members opening the same workspace at once would otherwise both see
 * `pending` and both provision. The compare-and-set means exactly one wins;
 * the loser gets `null` and simply waits for the winner's VM.
 */
async function claimProvisioning(workspaceId: string) {
  const claimed = await getDatabase()
    .update(schema.gen2Workspaces)
    .set({ status: "provisioning", lastError: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.gen2Workspaces.id, workspaceId),
        inArray(schema.gen2Workspaces.status, ["pending", "stopped", "failed"]),
      ),
    )
    .returning({ id: schema.gen2Workspaces.id });
  return claimed.length > 0;
}

/**
 * Makes sure this workspace has a machine, and returns once it does.
 *
 * There is no "start" button: opening a workspace is the intent to use it, so
 * this runs on open and on create. It is idempotent and safe to call from any
 * member -- a workspace nobody can start is a workspace nobody can use, and
 * the owner is not always the person who opens the share link first.
 */
export async function ensureGen2Instance(
  workspaceId: string,
  userId: string,
  runtime?: Gen2SandboxRuntime,
) {
  const membership = await requireGen2Member(workspaceId, userId);
  if (membership.status === "ready") return membership;
  const resolved =
    runtime ??
    createFirecrackerRuntime(
      await buildGen2SandboxSource(
        userId,
        membership.repository,
        await readGen2BaseSha(workspaceId),
      ),
    );
  if (!(await claimProvisioning(workspaceId))) {
    // Someone else is already bringing it up; report the live status rather
    // than racing them for the same guest.
    return requireGen2Member(workspaceId, userId);
  }

  const previousStatus = membership.status;
  try {
    await ensureHostReady();
  } catch (error) {
    const message = describeGen2RuntimeFailure(error);
    logEvent("error", "gen2.instance.host_unready", {
      detail: error instanceof Error ? error.message : "unknown",
    });
    await writeGen2Instance(workspaceId, {
      status: previousStatus,
      lastError: message,
    });
    throw new Gen2LifecycleError(message, 503);
  }

  try {
    const existing = resolved.current
      ? await resolved.current(workspaceId)
      : null;
    const sandbox =
      existing ??
      (await resolved.provision(
        workspaceId,
        new Date(
          Date.now() + GEN2_SANDBOX_LIFECYCLE.timeoutMs - GEN2_EXPIRES_SLACK_MS,
        ),
      ));
    await writeGen2Instance(workspaceId, {
      status: "ready",
      sandboxId: sandbox.id,
      lastError: null,
    });
  } catch (error) {
    const message = describeGen2RuntimeFailure(error);
    logEvent("error", "gen2.instance.start_failed", {
      detail: error instanceof Error ? error.message : "unknown",
    });
    await writeGen2Instance(workspaceId, {
      status: "failed",
      lastError: message,
    });
    throw new Gen2LifecycleError(message, 502);
  }

  return requireGen2Member(workspaceId, userId);
}

export async function stopGen2Instance(
  workspaceId: string,
  userId: string,
  runtime: Gen2SandboxRuntime = createFirecrackerRuntime(),
) {
  const membership = await requireGen2Member(workspaceId, userId);
  if (membership.role !== "owner") {
    throw new Gen2AccessError("Only the owner can stop this instance.", 403);
  }
  if (!canStopInstance(membership.status)) {
    throw new Gen2LifecycleError("This instance is not running.");
  }

  await runtime.destroy(workspaceId);
  await writeGen2Instance(workspaceId, {
    status: "stopped",
    sandboxId: null,
    lastError: null,
  });

  return requireGen2Member(workspaceId, userId);
}
