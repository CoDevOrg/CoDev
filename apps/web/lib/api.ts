import { auth } from "@/auth";

export async function getApiUser() {
  const session = await auth();
  return session?.user ?? null;
}

export function apiError(error: unknown, status = 400) {
  const message =
    error instanceof Error
      ? error.message
      : "The request could not be completed.";
  return Response.json({ error: message }, { status });
}
