import "server-only";

import { sandboxInstanceSchema, type SandboxInstance } from "@codev/contracts";
import { z } from "zod";

import type { RepositorySnapshot } from "../github/github";
import { OrchestratorError, orchestratorRequest } from "./orchestrator-request";

export interface ProvisionSandboxInput {
  workspaceId: string;
  ephemeral?: boolean;
  repositoryUrl: string | null;
  repositorySnapshot?: RepositorySnapshot;
  baseSha: string;
  expiresAt: string;
  resumeFromSnapshot: boolean;
  lifecycle: {
    timeoutMs: number;
    lifecycle: { onTimeout: "pause"; autoResume: true };
  };
}

export async function provisionSandbox(
  input: ProvisionSandboxInput,
): Promise<SandboxInstance> {
  const response = await orchestratorRequest("POST", "/v1/sandboxes", input);
  const payload = z
    .object({ sandbox: sandboxInstanceSchema })
    .parse(await response.json());
  return payload.sandbox;
}

export async function getSandbox(
  workspaceId: string,
): Promise<SandboxInstance> {
  const response = await orchestratorRequest(
    "GET",
    `/v1/sandboxes/${workspaceId}`,
  );
  const payload = z
    .object({ sandbox: sandboxInstanceSchema })
    .parse(await response.json());
  return payload.sandbox;
}

export async function destroySandbox(workspaceId: string) {
  try {
    await orchestratorRequest("DELETE", `/v1/sandboxes/${workspaceId}`);
  } catch (error) {
    if (error instanceof OrchestratorError && error.status === 404) {
      return;
    }
    throw error;
  }
}

export async function resumeSandbox(workspaceId: string) {
  try {
    await orchestratorRequest("POST", `/v1/sandboxes/${workspaceId}/resume`);
  } catch (error) {
    if (error instanceof OrchestratorError && error.status === 404) return;
    throw error;
  }
}

export async function discardSandboxSnapshot(workspaceId: string) {
  try {
    await orchestratorRequest(
      "DELETE",
      `/v1/sandboxes/${workspaceId}/snapshot`,
    );
  } catch (error) {
    if (error instanceof OrchestratorError && error.status === 404) return;
    throw error;
  }
}

export async function touchSandbox(workspaceId: string) {
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/activity`,
  );
  return z
    .object({ sandbox: sandboxInstanceSchema })
    .parse(await response.json()).sandbox;
}
