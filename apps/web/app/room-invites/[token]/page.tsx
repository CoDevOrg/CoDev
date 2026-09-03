import type { Metadata } from "next";
import Link from "next/link";
import { MessagesSquare } from "lucide-react";

import { AcceptRoomInvite } from "@/components/accept-room-invite";
import { Brand } from "@/components/app-chrome";
import { getCurrentAppUser } from "@/lib/identity";

export const metadata: Metadata = { title: "Room invitation" };

export default async function RoomInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const user = await getCurrentAppUser();
  const destination = `/room-invites/${token}`;

  return (
    <main className="auth-page">
      <div className="auth-nav">
        <Brand />
        <Link href="/">Home</Link>
      </div>
      <section className="auth-card invite-card">
        <span className="auth-glyph" aria-hidden="true">
          <MessagesSquare aria-hidden="true" />
        </span>
        <p className="eyebrow">Collaborative room invitation</p>
        <h1>You’ve been invited into the conversation.</h1>
        <p>
          Join this CoDev room to read the imported conversation with its other
          members.
        </p>
        {user ? (
          <AcceptRoomInvite token={token} />
        ) : (
          <Link
            className="github-button"
            href={`/sign-in?callbackUrl=${encodeURIComponent(destination)}`}
          >
            Sign in with Google or GitHub to continue
          </Link>
        )}
        <small>Invitation links expire after 24 hours and work once.</small>
      </section>
    </main>
  );
}
