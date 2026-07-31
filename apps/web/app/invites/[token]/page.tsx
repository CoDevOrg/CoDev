import type { Metadata } from "next";
import Link from "next/link";

import { AcceptInvite } from "@/components/accept-invite";
import { Brand } from "@/components/app-chrome";
import { getCurrentAppUser } from "@/lib/identity";

export const metadata: Metadata = { title: "Workspace invitation" };

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const user = await getCurrentAppUser();

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
        {user ? (
          <AcceptInvite token={token} />
        ) : (
          <Link
            className="github-button"
            href={`/sign-in?callbackUrl=${encodeURIComponent(`/invites/${token}`)}`}
          >
            Sign in with Google or GitHub to continue
          </Link>
        )}
        <small>Invitation links expire after 24 hours and work once.</small>
      </section>
    </main>
  );
}
