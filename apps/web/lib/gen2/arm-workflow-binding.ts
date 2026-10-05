import { runtimeEnvironment } from "@/lib/platform/runtime-environment";
import "server-only";
import { env } from "cloudflare:workers";
import type { ArmWorkspaceWorkflowParams } from "@codev/contracts";
import { Gen2LifecycleError } from "./errors";

export type WorkflowBinding = {
  create(options: {
    id: string;
    params: ArmWorkspaceWorkflowParams;
  }): Promise<unknown>;
  get(id: string): Promise<{ status(): Promise<{ status?: string }> }>;
};

export function nativeArmWorkflowBinding() {
  const binding = (env as { GEN2_ARM_WORKSPACE_LIFECYCLE?: WorkflowBinding })
    .GEN2_ARM_WORKSPACE_LIFECYCLE;
  if (!binding)
    throw new Gen2LifecycleError("ARM workflow binding is unavailable.", 503);
  return binding;
}

async function bridgeRequest(
  method: string,
  operationId: string,
  params?: ArmWorkspaceWorkflowParams,
) {
  const secret = runtimeEnvironment().CRON_SECRET;
  if (!secret)
    throw new Gen2LifecycleError(
      "ARM workflow authentication is unavailable.",
      503,
    );
  const url = new URL("https://trycodev.com/api/gen2/compute/workflow");
  url.searchParams.set("id", operationId);
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    ...(params ? { body: JSON.stringify(params) } : {}),
    signal: AbortSignal.timeout(30_000),
    redirect: "manual",
    cache: "no-store",
  });
  if (!response.ok)
    throw new Gen2LifecycleError(
      "The ARM workflow service is unavailable.",
      503,
    );
  return response.json() as Promise<{ status?: string }>;
}

export function armWorkflowBinding(): WorkflowBinding {
  if (
    (env as { GEN2_ARM_WORKSPACE_LIFECYCLE?: WorkflowBinding })
      .GEN2_ARM_WORKSPACE_LIFECYCLE
  )
    return nativeArmWorkflowBinding();
  return {
    create: ({ id, params }) => bridgeRequest("POST", id, params),
    get: async (id) => ({ status: () => bridgeRequest("GET", id) }),
  };
}
