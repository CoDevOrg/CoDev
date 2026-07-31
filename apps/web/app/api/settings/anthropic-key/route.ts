import { z } from "zod";

import { apiError, getApiUser } from "@/lib/api";
import {
  deleteProviderCredential,
  getProviderCredentialStatus,
  saveAnthropicCredential,
} from "@/lib/credentials";

const requestSchema = z.object({ apiKey: z.string().min(20).max(512) });

export async function GET() {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  return Response.json(
    await getProviderCredentialStatus("USER", user.id, "anthropic"),
  );
}

export async function PUT(request: Request) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  try {
    const { apiKey } = requestSchema.parse(await request.json());
    await saveAnthropicCredential(user.id, apiKey);
    return Response.json({ saved: true, lastFour: apiKey.trim().slice(-4) });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE() {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  try {
    await deleteProviderCredential("USER", user.id, "anthropic");
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
