import { z } from "zod";

import { withWorkspace } from "@/lib/api-route";
import {
  loadProviderConnectionSnapshot,
  revokePersonalProviderConnection,
  savePersonalProviderConnection,
} from "@/lib/provider-connection-server";
import { publicProviderConnectionPayload } from "@/lib/provider-connection-view";

const providerSchema = z.enum(["openai", "anthropic"]);

const putSchema = z.object({
  provider: providerSchema,
  apiKey: z.string().trim().min(20).max(512),
});

export const GET = withWorkspace(
  "view",
  async ({ user }) =>
    Response.json(
      publicProviderConnectionPayload(
        await loadProviderConnectionSnapshot(user),
      ),
    ),
  { errorStatus: 502 },
);

export const PUT = withWorkspace("view", async ({ request, user }) => {
  const input = putSchema.parse(await request.json());
  return Response.json(
    await savePersonalProviderConnection(user, input.provider, input.apiKey),
  );
});

export const DELETE = withWorkspace("view", async ({ request, user }) => {
  const provider = providerSchema.parse(
    new URL(request.url).searchParams.get("provider"),
  );
  return Response.json(await revokePersonalProviderConnection(user, provider));
});
