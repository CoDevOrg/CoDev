import { getCurrentAppUser } from "@/lib/identity";

export async function getApiUser() {
  return getCurrentAppUser();
}

export function apiError(error: unknown, status = 400) {
  const message =
    error instanceof Error
      ? error.message
      : "The request could not be completed.";
  return Response.json({ error: message }, { status });
}
