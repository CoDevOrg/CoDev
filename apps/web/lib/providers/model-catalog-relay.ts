import "server-only";
import { gen2AccountModelResponseSchema } from "@codev/contracts";
import { runtimeEnvironment } from "../platform/runtime-environment";
import { modelCatalogRequest } from "./model-catalog-request";

/** ChatGPT rejects Worker egress; use the existing authenticated Vercel service. */
export async function getRelayedCodexAccountModels(userId: string) {
  const secret = runtimeEnvironment().CRON_SECRET;
  if (!secret) throw new Error("Account model service is unavailable.");
  const result = await modelCatalogRequest(
    "https://codev-co-dev-admins.vercel.app/api/gen2/providers",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ userId, provider: "codex" }),
    },
  );
  return gen2AccountModelResponseSchema.parse(result).models;
}
