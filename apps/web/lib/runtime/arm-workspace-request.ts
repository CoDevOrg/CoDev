import "server-only";

import { ArmWorkflowIO } from "./arm-workflow-io";
import { capabilityToken } from "./arm-workspace-provider";
import { boundedJsonRequest } from "../gen2/bounded-request";
import { recordArmWorkspaceMemberActivity } from "./arm-workspace-member-activity";
import { logEvent } from "../platform/observability";

type Target = { workspaceId: string; generation: number; host: string };

export type ArmWorkspaceRequestOptions = {
  /** Off for reads that must not keep the guest awake, such as port checks. */
  recordActivity?: boolean | undefined;
};

/** Guest replies omit the host API envelopes consumed by existing clients. */
function envelope(path: string, payload: unknown) {
  if (path === "/v1/files/read") return { file: payload };
  if (
    path === "/v1/pty/exec" ||
    /^\/v1\/(?:terminals|codex-execs)\/[^/]+\/poll$/.test(path)
  )
    return { result: payload };
  return payload;
}

export async function armWorkspaceRequest(
  target: Target,
  method: string,
  path: string,
  body: unknown,
  timeoutMs: number,
  options: ArmWorkspaceRequestOptions = {},
) {
  const encodedBody = body === undefined ? "" : JSON.stringify(body);
  const token = await capabilityToken(
    target.host,
    target.workspaceId,
    target.generation,
    {
      method,
      path,
      scope: "workspace",
      body: encodedBody,
    },
  );
  const { response, payload } = await ArmWorkflowIO.request("guest", () =>
    boundedJsonRequest<unknown>(
      `https://${target.host}${path}`,
      {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: encodedBody }),
        cache: "no-store",
        redirect: "manual",
      },
      timeoutMs,
    ),
  );
  if (response.ok && options.recordActivity !== false)
    await recordArmWorkspaceMemberActivity(
      target.workspaceId,
      target.generation,
      method,
      path,
    ).catch(() => {
      logEvent("warn", "gen2.arm.activity_failed", {
        workspaceId: target.workspaceId,
      });
    });
  return Response.json(response.ok ? envelope(path, payload) : payload, {
    status: response.status,
  });
}
