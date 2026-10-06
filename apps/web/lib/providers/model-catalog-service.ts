import "server-only";
import { timingSafeEqual } from "node:crypto";
import { gen2AccountModelRequestSchema } from "@codev/contracts";
import { runtimeEnvironment } from "../platform/runtime-environment";
import { readJson } from "../http/api-route";
import { Gen2LifecycleError } from "../gen2/errors";
import { getDynamicModelsForProvider } from "./dynamic-models";

/** Internal service accepts member IDs, never account tokens or arbitrary URLs. */
export async function discoverAccountModelsForWorker(request: Request) {
  const secret = runtimeEnvironment().CRON_SECRET;
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(secret ? `Bearer ${secret}` : "");
  if (
    !secret ||
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  )
    throw new Gen2LifecycleError("Unauthorized.", 401);
  if (
    typeof navigator !== "undefined" &&
    navigator.userAgent === "Cloudflare-Workers"
  )
    throw new Gen2LifecycleError("Account model service unavailable.", 503);
  const { userId, provider } = await readJson(
    request,
    gen2AccountModelRequestSchema,
  );
  try {
    return { models: await getDynamicModelsForProvider(provider, userId) };
  } catch {
    throw new Gen2LifecycleError("Account model service unavailable.", 503);
  }
}
