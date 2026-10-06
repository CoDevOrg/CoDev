import "server-only";
import { z } from "zod";
import type { ResolvedSecret } from "./registry";
import { modelCatalogRequest } from "./model-catalog-request";

const usableSchema = z.object({
  models: z.array(
    z.object({
      modelId: z.string().min(1),
      displayModelId: z.string().optional(),
      displayName: z.string().optional(),
    }),
  ),
});
const selectionSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      serverModelName: z.string().optional(),
      legacySlugs: z.array(z.string()).default([]),
      variants: z
        .array(
          z.object({
            legacySlug: z.string().optional(),
            variantStringRepresentation: z.string().optional(),
          }),
        )
        .default([]),
    }),
  ),
  displayConfiguration: z
    .object({ modelSelectionRestrictionMessage: z.string().optional() })
    .optional(),
});

async function cursorToken(secret: ResolvedSecret) {
  if (secret.kind === "cursor_auth_cache") {
    return z
      .object({ accessToken: z.string().min(1) })
      .parse(JSON.parse(secret.authCacheJson)).accessToken;
  }
  if (secret.kind !== "api_key")
    throw new Error("Cursor connection unavailable.");
  const result = await modelCatalogRequest(
    "https://api2.cursor.sh/auth/exchange_user_api_key",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret.apiKey}`,
        "content-type": "application/json",
      },
      body: "{}",
    },
  );
  return z.object({ accessToken: z.string().min(1) }).parse(result).accessToken;
}

async function cursorCatalog(secret: ResolvedSecret) {
  const headers = {
    authorization: `Bearer ${await cursorToken(secret)}`,
    "content-type": "application/json",
    "connect-protocol-version": "1",
  };
  const [usable, selection] = await Promise.all([
    modelCatalogRequest(
      "https://api2.cursor.sh/agent.v1.AgentService/GetUsableModels",
      { method: "POST", headers, body: "{}" },
    ).then((value) => usableSchema.parse(value)),
    modelCatalogRequest(
      "https://api2.cursor.sh/aiserver.v1.AiService/AvailableModels",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          useModelParameters: true,
          doNotUseMarkdown: true,
        }),
      },
    ).then((value) => selectionSchema.parse(value)),
  ]);
  return { usable, selection };
}

export async function getCursorAccountModels(secret: ResolvedSecret) {
  const { usable, selection } = await cursorCatalog(secret);
  const allowed = new Set(
    selection.models.flatMap((model) => [
      model.name,
      model.serverModelName,
      ...model.legacySlugs,
      ...model.variants.flatMap((variant) => [
        variant.legacySlug,
        variant.variantStringRepresentation,
      ]),
    ]),
  );
  const restricted = Boolean(
    selection.displayConfiguration?.modelSelectionRestrictionMessage?.trim(),
  );
  return usable.models
    .filter((model) => !restricted || allowed.has(model.modelId))
    .map((model) => ({
      id: model.displayModelId || model.modelId,
      label: model.displayName || model.displayModelId || model.modelId,
    }))
    .sort(
      (a, b) =>
        Number(a.label.toLowerCase() === "auto") -
        Number(b.label.toLowerCase() === "auto"),
    );
}
