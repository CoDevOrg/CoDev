"use server";

import { signOut } from "@/auth";

export async function signOutToHome() {
  await signOut({ redirectTo: "/" });
}
