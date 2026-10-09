"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { RequestAccessButton } from "./request-access-button";

export function LandingNavigation({
  signedIn = false,
}: {
  signedIn?: boolean;
}) {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const update = () => setCompact(window.scrollY > 72);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <div className="lp-nav-shell">
      <header className="lp-nav" data-compact={compact}>
        <Link className="lp-brand" href="/" aria-label="CoDev home">
          <Image
            src="/brand/codev-mark.svg"
            alt=""
            width={40}
            height={40}
            priority
          />
          <span>CoDev</span>
        </Link>
        <nav aria-label="Primary">
          <Link href="/pricing">Pricing</Link>
          <Link href="/docs">Docs</Link>
        </nav>
        {signedIn ? (
          <Link className="lp-cta lp-cta-small" href="/gen2">
            Open dashboard <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <RequestAccessButton className="lp-cta lp-cta-small">
            Join the waitlist <span aria-hidden="true">→</span>
          </RequestAccessButton>
        )}
      </header>
    </div>
  );
}
