import "server-only";

import { redirect } from "next/navigation";

import { getCurrentAppUser } from "@/lib/identity";

export async function requireUser() {
  const user = await getCurrentAppUser();
  if (!user?.id) {
    redirect("/sign-in");
  }

  return user;
}
