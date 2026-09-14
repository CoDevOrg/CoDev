import "server-only";

import { redirect } from "next/navigation";

import { getCurrentAppUser } from "@/lib/identity";

export async function requireUser(callbackUrl?: string) {
  const user = await getCurrentAppUser();
  if (!user?.id) {
    redirect(
      callbackUrl
        ? `/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`
        : "/sign-in",
    );
  }

  return user;
}
