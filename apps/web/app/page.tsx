import { Fragment } from "react";
import type { CSSProperties } from "react";
import type { Metadata } from "next";
import {
  Instrument_Serif,
  Inter_Tight,
  JetBrains_Mono,
} from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonClassName } from "@/components/ui/button";
import { LandingNavigation } from "@/components/landing/landing-navigation";
import { CompanyLogos } from "@/components/landing/company-logos";
import { HowItWorks } from "@/components/landing/how-it-works";
import { LandingMotion } from "@/components/landing/landing-motion";
import { RequestAccessButton } from "@/components/landing/request-access-button";
import { WaitlistInline } from "@/components/landing/waitlist-inline";
import { LandingBackdrop } from "@/components/landing/backdrop/landing-backdrop";
import { getCurrentAppUser } from "@/lib/auth/identity";

import "./landing.css";
import "@/components/landing/landing-design.css";

/**
 * The landing page loads Instrument Serif for display type. Body and mono
 * fonts come from the root layout (Inter Tight + JetBrains Mono), shared
 * with the product so the signed-in app matches the marketing surface.
 */
const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--lp-font-sans",
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--lp-font-serif",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--lp-font-mono",
  display: "swap",
});

const LANDING_FONTS = [
  interTight.variable,
  instrumentSerif.variable,
  jetbrainsMono.variable,
].join(" ");

/** The headline, split so each word can carry its own parallax depth. */
const HEADLINE = ["Your team.", "Your agents."];

const DESCRIPTION =
  "Build software with your team and AI agents in one live cloud workspace. Share code, a terminal, and localhost. Join the private beta waitlist.";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.trycodev.com"),
  title: "One cloud workspace for your team and AI agents",
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "CoDev",
    url: "https://www.trycodev.com",
    title: "One cloud workspace for your team and AI agents",
    description: DESCRIPTION,
    images: [
      {
        url: "/brand/landing/workspace-share.png",
        width: 1200,
        height: 630,
        alt: "CoDev: your team and AI agents in one live cloud workspace",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CoDev · One cloud workspace for your team and AI agents",
    description: DESCRIPTION,
    images: ["/brand/landing/workspace-share.png"],
  },
};

export default async function HomePage() {
  if (await getCurrentAppUser()) {
    redirect("/gen2");
  }

  return (
    <main className={`lp-page ${LANDING_FONTS}`}>
      <LandingMotion />

      <LandingNavigation />

      <section className="lp-hero">
        <div className="lp-backdrop" aria-hidden="true">
          <div className="lp-mark" />
          <div className="lp-canvas-still" />
          <div className="lp-aurora lp-aurora-a" />
          <div className="lp-aurora lp-aurora-b" />
          <div className="lp-aurora lp-aurora-c" />
          <div className="lp-grid" />
          <div className="lp-grain" />
        </div>
        <LandingBackdrop />

        <p className="lp-pill">
          <i aria-hidden="true" /> Private beta · now inviting builders
        </p>
        <h1 className="lp-kinetic">
          {HEADLINE.map((word, index) => (
            <Fragment key={word}>
              {/* The separating space is a text node outside the span on
                  purpose: each word is an inline-block for its own parallax
                  depth, and an inline-block trims its own trailing space,
                  which runs the headline together. */}
              <span
                className="lp-kinetic-word"
                style={{ "--i": index + 1 } as CSSProperties}
              >
                {word}
              </span>
              {index < HEADLINE.length - 1 ? " " : null}
            </Fragment>
          ))}
          <br />
          <em style={{ "--i": 3 } as CSSProperties}>One cloud workspace.</em>
        </h1>
        <p className="lp-platform">
          The world&apos;s first multiplayer AI platform.
        </p>
        <p className="lp-lede">
          Bring your team and AI agents into the same cloud development
          workspace. Share a repo, write code, run commands, and review changes
          together in real time.
        </p>
        <div className="lp-hero-actions">
          <RequestAccessButton className="lp-cta lp-cta-primary">
            Join the waitlist
          </RequestAccessButton>
        </div>
      </section>

      <CompanyLogos />

      <HowItWorks />

      <section className="lp-request" data-reveal>
        <div className="lp-request-heading">
          <h2>Deploy your first workspace.</h2>
          <p>Your team. Your agents. One place to build.</p>
        </div>
        <WaitlistInline />
      </section>

      <footer className="lp-footer">
        <Link className="lp-brand" href="/" aria-label="CoDev home">
          <Image src="/brand/codev-mark-v3.png" alt="" width={26} height={26} />
          <span>CoDev</span>
        </Link>
        <p>People and agents, building in the same room.</p>
        <nav aria-label="Footer">
          <Link href="/pricing">Pricing</Link>
          <Link href="/docs">Docs</Link>
          <Link href="/legal/privacy">Privacy</Link>
          <Link href="/legal/terms">Terms</Link>
          <Link href="/legal/refunds">Refunds & cancellation</Link>
          <Link href="/legal/retention">Data retention</Link>
          <Link
            className={buttonClassName({
              variant: "outline",
              size: "sm",
              className: "lp-footer-sign-in",
            })}
            href="/sign-in"
          >
            Sign in
          </Link>
        </nav>
      </footer>
    </main>
  );
}
