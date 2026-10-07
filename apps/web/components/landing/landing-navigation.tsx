"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { RequestAccessButton } from "./request-access-button";

export function LandingNavigation() {
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
            src="/brand/codev-mark-v3.png"
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
        <RequestAccessButton className="lp-cta lp-cta-small">
          Join the waitlist <span aria-hidden="true">→</span>
        </RequestAccessButton>
      </header>
    </div>
  );
}
