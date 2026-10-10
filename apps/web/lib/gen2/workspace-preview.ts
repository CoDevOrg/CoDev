import "server-only";

import type {
  Gen2PreviewSessionRequest,
  Gen2PreviewSessionResponse,
} from "@codev/contracts";

import { logEvent } from "../platform/observability";
import { PUBLIC_APP_ORIGIN } from "../platform/site-hosts";
import { ArmWorkspaceRuntimeError } from "../runtime/arm-workspace-error";
import {
  armWorkspacePreviewToken,
  ensureArmWorkspacePreviewRoute,
} from "../runtime/arm-workspace-preview-route";
import { runtimeTargetFromRow } from "../runtime/workspace-runtime-target";
import { Gen2AccessError, Gen2LifecycleError } from "./errors";
import { gen2PreviewAccess } from "./preview-access";
import {
  isGen2PreviewDevDirect,
  readGen2PreviewConfig,
} from "./preview-config";
import { allowGen2PreviewSession } from "./preview-rate-limit";

/** Session tokens are single-use and must be redeemed within a minute. */
const TOKEN_LIFETIME_MS = 60_000;
const APP_ORIGINS = new Set(["https://trycodev.com", PUBLIC_APP_ORIGIN]);

/**
 * The page that will frame the preview. The guest allows exactly this
 * origin in `frame-ancestors`, so it must be an app host (localhost too
 * outside production), already matched to the request by `withUser`.
 */
function appOriginOf(origin: string | null) {
  if (origin && APP_ORIGINS.has(origin)) return origin;
  if (
    origin &&
    process.env.NODE_ENV !== "production" &&
    /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(origin)
  )
    return origin;
  throw new Gen2AccessError("Open previews from CoDev.", 403);
}

function sessionUrl(host: string, token: string, path: string) {
  const url = new URL(`https://${host}/__codev/preview/session`);
  url.search = new URLSearchParams({ token, next: path }).toString();
  return url.toString();
}

type ArmPreview = {
  workspaceId: string;
  userId: string;
  appOrigin: string;
  port: number;
  path: string;
  access: Awaited<ReturnType<typeof gen2PreviewAccess>>;
  config: NonNullable<ReturnType<typeof readGen2PreviewConfig>>;
};

/** Routes the preview host to the guest's tunnel and signs its token. */
async function armPreviewUrl(preview: ArmPreview) {
  const { access, port } = preview;
  const target = await runtimeTargetFromRow(preview.workspaceId, access);
  if (!target || !access.tunnelId)
    throw new Gen2LifecycleError("Update this workspace to use the browser.");
  try {
    const { workspaceId, generation } = target;
    const host = await ensureArmWorkspacePreviewRoute({
      ...preview.config,
      workspaceId,
      generation,
      tunnelId: access.tunnelId,
      port,
    });
    const token = await armWorkspacePreviewToken({
      host,
      workspaceId,
      generation,
      port,
      userId: preview.userId,
      appOrigin: preview.appOrigin,
    });
    return sessionUrl(host, token, preview.path);
  } catch (error) {
    if (!(error instanceof ArmWorkspaceRuntimeError)) throw error;
    logEvent("warn", "gen2.preview.route_failed", {
      workspaceId: preview.workspaceId,
      code: error.code,
    });
    throw new Gen2LifecycleError(
      "Couldn’t prepare the preview. Try again.",
      502,
    );
  }
}

/**
 * Mints a preview session for one port of an editor's workspace. The guest
 * proxy redeems the URL's token for a short-lived cookie on that host. One
 * membership and route query; viewers never reach the rate limit or guest.
 */
export async function createGen2PreviewSession(input: {
  workspaceId: string;
  userId: string;
  origin: string | null;
  request: Gen2PreviewSessionRequest;
}): Promise<Gen2PreviewSessionResponse> {
  const { workspaceId, userId, request } = input;
  const access = await gen2PreviewAccess(workspaceId, userId);
  const config = readGen2PreviewConfig();
  const devDirect = isGen2PreviewDevDirect();
  if (!config && !devDirect)
    throw new Gen2LifecycleError("Browser previews are not set up.", 501);
  if (!(await allowGen2PreviewSession(userId, workspaceId)))
    throw new Gen2LifecycleError("Too many previews opened. Try again.", 429);
  const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString();
  if (devDirect || !config) {
    const url = `http://localhost:${request.port}${request.path}`;
    return { url, expiresAt };
  }
  const url = await armPreviewUrl({
    workspaceId,
    userId,
    appOrigin: appOriginOf(input.origin),
    ...request,
    access,
    config,
  });
  return { url, expiresAt };
}
