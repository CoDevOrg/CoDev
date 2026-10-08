import "server-only";
import { z } from "zod";
import type { ResolvedSecret } from "./registry";
import { modelCatalogRequest } from "./model-catalog-request";
import { runtimeEnvironment } from "../platform/runtime-environment";

/**
 * ChatGPT lists only the models this Codex version supports. Image releases
 * set it to the promoted image's Codex pin, so the catalog never offers a
 * model the live workspace CLI cannot run.
 */
function codexClientVersion() {
  const version = runtimeEnvironment().CODEX_CATALOG_CLIENT_VERSION?.trim();
  return version && /^\d+\.\d+\.\d+$/.test(version) ? version : "0.148.0";
}

const catalog = z.object({
  models: z.array(
    z.object({
      slug: z.string().min(1),
      display_name: z.string().min(1),
      description: z.string().nullish(),
      visibility: z.string(),
      priority: z.number(),
      available_in_plans: z.array(z.string()).nullish(),
    }),
  ),
});

function accountPlan(token: string | undefined) {
  try {
    const claims = JSON.parse(
      Buffer.from(token?.split(".")[1] ?? "", "base64url").toString(),
    );
    const plan = claims["https://api.openai.com/auth"]?.chatgpt_plan_type;
    return typeof plan === "string" ? plan : undefined;
  } catch {
    return undefined;
  }
}

async function apiKeyModels(apiKey: string) {
  const payload = z
    .object({ data: z.array(z.object({ id: z.string() })) })
    .parse(
      await modelCatalogRequest("https://api.openai.com/v1/models", {
        headers: { authorization: `Bearer ${apiKey}` },
      }),
    );
  return payload.data
    .filter(
      ({ id }) =>
        !/(audio|image|realtime|transcribe|tts|embedding|moderation|safeguard)/i.test(
          id,
        ),
    )
    .map(({ id }) => ({ id, label: id }));
}

export async function getCodexAccountModels(secret: ResolvedSecret) {
  if (secret.kind === "api_key") return apiKeyModels(secret.apiKey);
  if (secret.kind !== "codex_auth_cache")
    throw new Error("Codex connection unavailable.");
  const { tokens } = z
    .object({
      tokens: z.object({
        access_token: z.string(),
        account_id: z.string().optional(),
        id_token: z.string().optional(),
      }),
    })
    .parse(JSON.parse(secret.authCacheJson));
  const headers: Record<string, string> = {
    authorization: `Bearer ${tokens.access_token}`,
  };
  if (tokens.account_id) headers["ChatGPT-Account-Id"] = tokens.account_id;
  const data = catalog.parse(
    await modelCatalogRequest(
      `https://chatgpt.com/backend-api/codex/models?client_version=${codexClientVersion()}`,
      { headers },
    ),
  );
  const plan = accountPlan(tokens.access_token) ?? accountPlan(tokens.id_token);
  return data.models
    .filter(
      (model) =>
        model.visibility === "list" &&
        (!model.available_in_plans?.length ||
          Boolean(plan && model.available_in_plans.includes(plan))),
    )
    .sort((a, b) => a.priority - b.priority)
    .map((model) => ({
      id: model.slug,
      label: model.display_name,
      ...(model.description ? { description: model.description } : {}),
    }));
}
