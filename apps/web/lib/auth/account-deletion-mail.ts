import "server-only";

import { eq } from "drizzle-orm";
import { schema } from "@codev/db";
import { ApiError } from "../http/api-route";
import { getDatabase } from "../platform/database";
import { consumeRateLimit } from "../platform/rate-limit";
import { createAccountDeletionToken } from "./account-deletion-token";

export async function sendAccountDeletionVerification(userId: string) {
  const limit = await consumeRateLimit(
    userId,
    "account-deletion-email",
    3,
    900,
  );
  if (!limit.allowed)
    throw new ApiError(
      "Please wait 15 minutes before requesting another verification email.",
      429,
    );
  const [user] = await getDatabase()
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user?.email)
    throw new ApiError(
      "Add a verified email through your sign-in provider or contact admins@trycodev.com for help deleting your account.",
      409,
    );
  if (!process.env.RESEND_API_KEY)
    throw new ApiError(
      "Verification email is unavailable. Contact admins@trycodev.com.",
      503,
    );
  const token = createAccountDeletionToken(userId, user.email);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      from: process.env.AUTH_EMAIL_FROM ?? "CoDev <noreply@trycodev.com>",
      to: user.email,
      subject: "Confirm deletion of your CoDev account",
      text: `You requested account deletion. Paste this verification code in Settings → Profile within 15 minutes, then confirm deletion:\n\n${token}\n\nDeletion removes your account and stored connections and ends CoDev billing immediately. Shared contributions and required billing records may remain. Export your work first. If you did not request this, do not share this code. Nothing has been deleted.`,
    }),
  });
  if (!response.ok)
    throw new ApiError(
      "Verification email could not be sent. Please try again later.",
      503,
    );
}
