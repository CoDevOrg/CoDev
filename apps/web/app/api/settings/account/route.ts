import { accountDeletionSchema } from "@codev/contracts";
import { deleteAccount } from "@/lib/auth/account-deletion";
import { sendAccountDeletionVerification } from "@/lib/auth/account-deletion-mail";
import { ApiError, readJson, withUser } from "@/lib/http/api-route";

export const maxDuration = 60;

function requireSameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    throw new ApiError(
      "Open Settings on this site to delete your account.",
      403,
    );
  }
}

export const POST = withUser(async ({ request, user }) => {
  requireSameOrigin(request);
  await sendAccountDeletionVerification(user.id);
  return Response.json(
    { sent: true },
    { headers: { "Cache-Control": "no-store" } },
  );
});

export const DELETE = withUser(async ({ request, user }) => {
  requireSameOrigin(request);
  const body = await readJson(request, accountDeletionSchema);
  try {
    await deleteAccount(user.id, body.token);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // Billing can have completed before a database failure. Retry safely;
    // do not claim success or expose payment/database internals to the caller.
    throw new ApiError(
      "Deletion could not finish. Your subscription may already be canceled. Retry, or contact admins@trycodev.com.",
      503,
    );
  }
  return Response.json(
    { deleted: true },
    { headers: { "Cache-Control": "no-store" } },
  );
});
