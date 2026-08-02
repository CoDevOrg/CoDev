"use server";

import { cookies } from "next/headers";

import { isGitHubAuthConfigured } from "@codev/config";

import { signIn } from "@/auth";
import { getApiUser } from "@/lib/api";
import { createGithubLinkState, GITHUB_LINK_COOKIE } from "@/lib/github-link";

function safeReturnTo(value: string) {
  return value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/dashboard";
}

export async function connectGitHubAccount(returnTo = "/dashboard") {
  const user = await getApiUser();
  if (!user?.id) throw new Error("Authentication required.");
  if (!isGitHubAuthConfigured()) {
    throw new Error("GitHub account linking is not configured.");
  }

  const destination = safeReturnTo(returnTo);
  const cookieStore = await cookies();
  cookieStore.set(
    GITHUB_LINK_COOKIE,
    createGithubLinkState(user.id, destination),
    {
      httpOnly: true,
      maxAge: 10 * 60,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  );

  await signIn("github", { redirectTo: destination });
}
