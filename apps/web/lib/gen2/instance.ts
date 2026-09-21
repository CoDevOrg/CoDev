import "server-only";

import { eq } from "drizzle-orm";

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

export function canStartInstance(status: Gen2WorkspaceStatus) {
  return status === "pending" || status === "failed" || status === "stopped";
}

export function canStopInstance(status: Gen2WorkspaceStatus) {
  return status === "ready" || status === "provisioning";
}

const HOST_UNREACHABLE_MESSAGE =
  "The Firecracker host could not be reached. Wait a few seconds and try Start instance again.";

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

export type Gen2SandboxRuntime = {
  provision(workspaceId: string, expiresAt: Date): Promise<{ id: string }>;
  destroy(workspaceId: string): Promise<void>;
  current?(workspaceId: string): Promise<{ id: string } | null>;
};

export function createFirecrackerRuntime(): Gen2SandboxRuntime {
  const source = buildBlankSandboxSource();
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

export async function startGen2Instance(
  workspaceId: string,
  userId: string,
  runtime: Gen2SandboxRuntime = createFirecrackerRuntime(),
) {
  const membership = await requireGen2Member(workspaceId, userId);
  if (membership.role !== "owner") {
    throw new Gen2AccessError("Only the owner can start this instance.", 403);
  }
  if (!canStartInstance(membership.status)) {
    throw new Gen2LifecycleError(
      "This instance is already starting or running.",
    );
  }

  const previousStatus = membership.status;
  await writeGen2Instance(workspaceId, {
    status: "provisioning",
    lastError: null,
  });

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
    const existing = runtime.current
      ? await runtime.current(workspaceId)
      : null;
    const sandbox =
      existing ??
      (await runtime.provision(
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
