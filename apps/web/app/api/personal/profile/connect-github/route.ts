import { cookies } from "next/headers";

import { isGitHubAuthConfigured } from "@codev/config";

import { signIn } from "@/auth";
import { apiError, getApiUser } from "@/lib/api";
import { createGithubLinkState, GITHUB_LINK_COOKIE } from "@/lib/github-link";

/**
 * Starts the GitHub account-linking OAuth flow from the embedded personal
 * settings surface. The Orca iframe can't invoke a Next.js Server Action
 * directly, so this is a plain route the "Connect GitHub account" link
 * navigates the top-level window to (target="_top").
 */
export async function GET() {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  if (!isGitHubAuthConfigured()) {
    return apiError(
      new Error("GitHub account linking is not configured."),
      400,
    );
  }

  const destination = "/settings";
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

  const url = await signIn("github", {
    redirect: false,
    redirectTo: destination,
  });
  return Response.redirect(url);
}
