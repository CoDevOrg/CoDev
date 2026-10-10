import "server-only";

import { signArmControlPlaneToken } from "./arm-control-plane-token";

/**
 * A single-use, 60-second session token for exactly one preview host. Its
 * `aud` and `scope` keep the gateway from accepting it, and gateway
 * capabilities from opening previews.
 */
export function armWorkspacePreviewToken(input: {
  host: string;
  workspaceId: string;
  generation: number;
  port: number;
  userId: string;
  appOrigin: string;
}) {
  return signArmControlPlaneToken({
    aud: input.host,
    scope: "preview",
    workspaceId: input.workspaceId,
    generation: input.generation,
    port: input.port,
    sub: input.userId,
    appOrigin: input.appOrigin,
    jti: crypto.randomUUID(),
  });
}
