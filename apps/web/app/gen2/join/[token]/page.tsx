import type { Metadata } from "next";
import Link from "next/link";
import { Link2 } from "lucide-react";

import { JoinGen2Workspace } from "@/components/gen2/join-workspace";
import { Brand } from "@/components/shell/app-chrome";
import { getCurrentAppUser } from "@/lib/auth/identity";

export const metadata: Metadata = { title: "Join workspace" };

export default async function Gen2JoinPage({
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
        <Link href="/gen2">Workspaces</Link>
      </div>
      <section className="auth-card invite-card">
        <span className="auth-glyph" aria-hidden="true">
          <Link2 aria-hidden="true" />
        </span>
        <p className="eyebrow">Gen 2 invitation</p>
        <h1>Join this cloud workspace.</h1>
        <p>
          You will share the same Firecracker instance as everyone else on this
          link.
        </p>
        {user ? (
          <JoinGen2Workspace token={token} />
        ) : (
          <Link
            className="github-button"
            href={`/sign-in?callbackUrl=${encodeURIComponent(`/gen2/join/${token}`)}`}
          >
            Sign in to join
          </Link>
        )}
      </section>
    </main>
  );
}
