import { z } from "zod";

import { apiError, getApiUserAnyAuth } from "@/lib/api";
import {
  registerMobilePushToken,
  unregisterMobilePushToken,
} from "@/lib/mobile-push";

const registerSchema = z.object({
  expoPushToken: z.string().trim().min(1),
  platform: z.enum(["ios", "android"]),
  deviceId: z.string().trim().min(1).max(200).optional(),
});

export async function POST(request: Request) {
  const user = await getApiUserAnyAuth(request);
  if (!user) return apiError(new Error("Authentication required."), 401);
  try {
    const input = registerSchema.parse(await request.json());
    await registerMobilePushToken({ userId: user.id, ...input });
    return Response.json({ success: true });
  } catch (error) {
    return apiError(error);
  }
}

const unregisterSchema = z.object({
  expoPushToken: z.string().trim().min(1),
});

export async function DELETE(request: Request) {
  const user = await getApiUserAnyAuth(request);
  if (!user) return apiError(new Error("Authentication required."), 401);
  try {
    const input = unregisterSchema.parse(await request.json());
    await unregisterMobilePushToken(input.expoPushToken);
    return Response.json({ success: true });
  } catch (error) {
    return apiError(error);
  }
}
