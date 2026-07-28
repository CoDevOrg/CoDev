import type { Metadata } from "next";
import Link from "next/link";

import { auth } from "@/auth";
import { AcceptInvite } from "@/components/accept-invite";
import { Brand } from "@/components/app-chrome";

export const metadata: Metadata = { title: "Workspace invitation" };

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await auth();

  return (
    <main className="auth-page">
      <div className="auth-nav">
        <Brand />
        <Link href="/">Home</Link>
      </div>
      <section className="auth-card invite-card">
        <span className="auth-glyph" aria-hidden="true">
          ✦
        </span>
        <p className="eyebrow">Workspace invitation</p>
        <h1>You’ve been invited to build together.</h1>
        <p>
          Join this CoDev workspace. The owner controls terminal and merge
          capabilities after you arrive.
        </p>
        {session?.user ? (
          <AcceptInvite token={token} />
        ) : (
          <Link
            className="github-button"
            href={`/sign-in?callbackUrl=${encodeURIComponent(`/invites/${token}`)}`}
          >
            Sign in with GitHub to continue
          </Link>
        )}
        <small>Invitation links expire after 24 hours and work once.</small>
      </section>
    </main>
  );
}
