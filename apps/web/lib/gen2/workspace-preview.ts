import "server-only";

import type {
  Gen2PreviewSessionRequest,
  Gen2PreviewSessionResponse,
} from "@codev/contracts";

import { logEvent } from "../platform/observability";
import { PUBLIC_APP_ORIGIN } from "../platform/site-hosts";
import { ArmWorkspaceRuntimeError } from "../runtime/arm-workspace-error";
import { ensureArmWorkspacePreviewRoute } from "../runtime/arm-workspace-preview-route";
import { armWorkspacePreviewToken } from "../runtime/arm-workspace-preview-token";
import {
  runtimeTargetFromRow,
  type WorkspaceRuntimeTarget,
} from "../runtime/workspace-runtime-target";
import { Gen2AccessError, Gen2LifecycleError } from "./errors";
import { gen2PreviewAccess } from "./preview-access";
import {
  isGen2PreviewDevDirect,
  readGen2PreviewConfig,
} from "./preview-config";
import {
  isGen2PreviewBootEnabled,
  isGen2PreviewGuestBusy,
  readGen2PreviewSockets,
} from "./preview-guest";
import {
  allowGen2PreviewRoute,
  allowGen2PreviewSession,
} from "./preview-rate-limit";
import { isGen2PreviewReservedPort } from "./workspace-ports-parse";

/** Session tokens are single-use and must be redeemed within a minute. */
const TOKEN_LIFETIME_MS = 60_000;
const APP_ORIGINS = new Set(["https://trycodev.com", PUBLIC_APP_ORIGIN]);
const NEEDS_UPDATE = "Update this workspace to use the browser.";

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

/**
 * Port 5261 belongs to the preview proxy only on images that ship it; on
 * older guests any member process could bind it and serve the preview
 * hosts. Busy guests cannot show which, so the first mint waits for one.
 */
async function confirmProxy(
  workspaceId: string,
  target: WorkspaceRuntimeTarget,
) {
  let proxy = false;
  try {
    ({ proxy } = await readGen2PreviewSockets(workspaceId, target));
  } catch (error) {
    if (!isGen2PreviewGuestBusy(error)) throw error;
    throw new Gen2LifecycleError("Workspace is busy — try again.", 503);
  }
  if (!proxy) throw new Gen2LifecycleError(NEEDS_UPDATE);
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

/** Refuses before Cloudflare work when the member keeps cycling new hosts. */
async function reserveRoute(userId: string) {
  if (!(await allowGen2PreviewRoute(userId)))
    throw new Gen2LifecycleError("Too many previews opened. Try again.", 429);
}

/** Routes the preview host to the guest's tunnel and signs its token. */
async function armPreviewUrl(preview: ArmPreview) {
  const { access, port, userId, appOrigin } = preview;
  const target = await runtimeTargetFromRow(preview.workspaceId, access);
  if (!target || !access.tunnelId || !isGen2PreviewBootEnabled())
    throw new Gen2LifecycleError(NEEDS_UPDATE);
  const { workspaceId, generation } = target;
  try {
    const host = await ensureArmWorkspacePreviewRoute(
      {
        ...preview.config,
        workspaceId,
        generation,
        tunnelId: access.tunnelId,
        gatewayHost: target.host,
        port,
      },
      {
        reserve: () => reserveRoute(userId),
        confirmProxy: () => confirmProxy(workspaceId, target),
      },
    );
    const token = await armWorkspacePreviewToken({
      host,
      workspaceId,
      generation,
      port,
      userId,
      appOrigin,
    });
    return sessionUrl(host, token, preview.path);
  } catch (error) {
    if (!(error instanceof ArmWorkspaceRuntimeError)) throw error;
    logEvent("warn", "gen2.preview.route_failed", {
      workspaceId,
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
  if (isGen2PreviewReservedPort(request.port))
    throw new Gen2LifecycleError("This port can’t be previewed.", 400);
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
