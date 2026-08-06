import Image from "next/image";
import Link from "next/link";

import { isGitHubAuthConfigured } from "@codev/config";

import { FeedbackWidget } from "@/components/feedback-widget";
import { ProfileMenu } from "@/components/profile-menu";
import { clerkAuthConfigured } from "@/lib/identity";

export function Brand() {
  return (
    <Link className="wordmark" href="/" aria-label="CoDev home">
      <Image
        className="brand-image"
        src="/brand/codev-mark-v3.png"
        alt=""
        width={28}
        height={28}
      />
      <span>CoDev</span>
    </Link>
  );
}

export function AppChrome({
  user,
  children,
}: {
  user: { name?: string | null; githubLogin?: string; image?: string | null };
  children: React.ReactNode;
}) {
  return (
    <div className="app-page">
      <header className="app-nav">
        <Brand />
        <nav aria-label="Application navigation">
          <Link href="/dashboard">Workspaces</Link>
        </nav>
        <div className="user-menu">
          <ProfileMenu
            user={user}
            showConnectGitHub={!user.githubLogin && isGitHubAuthConfigured()}
            useClerkAuth={clerkAuthConfigured()}
          />
        </div>
      </header>
      {children}
      <FeedbackWidget />
    </div>
  );
}
