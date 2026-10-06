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
import { FlaskConical, GitBranch, MessagesSquare } from "lucide-react";

import { LandingMotion } from "@/components/landing/landing-motion";
import { RequestAccessButton } from "@/components/landing/request-access-button";
import { WaitlistInline } from "@/components/landing/waitlist-inline";
import { LandingBackdrop } from "@/components/landing/webgl/landing-backdrop";
import { getCurrentAppUser } from "@/lib/auth/identity";

import "./landing.css";

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
const HEADLINE = ["Ship", "it", "together."];

const DESCRIPTION =
  "CoDev is a shared cloud workspace where your team and an AI agent work in the same live environment. Open a repository, steer the work together, and review changes as they happen. Request access to the private beta.";

export const metadata: Metadata = {
  title: "Build together, with agents",
  description: DESCRIPTION,
  openGraph: {
    title: "Build together, with agents",
    description: DESCRIPTION,
    images: [
      {
        url: "/brand/landing/og-card.webp",
        width: 1200,
        height: 630,
        alt: "Three streams of work converging into one line",
      },
    ],
  },
};

export default async function HomePage() {
  if (await getCurrentAppUser()) {
    redirect("/gen2");
  }

  return (
    <main className={`lp-page ${LANDING_FONTS}`}>
      <LandingMotion />

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

      <header className="lp-nav">
        <Link className="lp-brand" href="/" aria-label="CoDev home">
          <Image
            src="/brand/codev-mark.svg"
            alt=""
            width={32}
            height={32}
            priority
          />
          <span>CoDev</span>
        </Link>
        <nav aria-label="Primary">
          <a href="#tour">How it works</a>
          <Link href="/pricing">Pricing</Link>
          <RequestAccessButton className="lp-cta lp-cta-small">
            Get early access
          </RequestAccessButton>
        </nav>
      </header>

      <section className="lp-hero">
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
          <em style={{ "--i": 4 } as CSSProperties}>Agents included.</em>
        </h1>
        <p className="lp-lede">
          CoDev gives your team and an AI agent one shared cloud environment for
          building, steering, and reviewing software together.
        </p>
        <div className="lp-hero-actions">
          <RequestAccessButton className="lp-cta lp-cta-primary">
            Get early access
          </RequestAccessButton>
        </div>
        <ul className="lp-hero-stats">
          <li>
            <strong>People + agents</strong>
            <span>in one workspace</span>
          </li>
          <li>
            <strong>One shared machine</strong>
            <span>for your team and agent</span>
          </li>
          <li>
            <strong>1 link</strong>
            <span>to bring anyone in</span>
          </li>
          <li>
            <strong>Your own keys</strong>
            <span>Claude or Codex</span>
          </li>
        </ul>
      </section>

      <section
        className="lp-speed"
        aria-labelledby="lp-speed-title"
        data-reveal
      >
        <div className="lp-speed-heading">
          <p className="lp-speed-kicker">Why it moves faster</p>
          <h2 id="lp-speed-title">
            Less waiting. <em>Less rework.</em>
          </h2>
          <p>
            CoDev puts the repository, agent conversation, and live workbench in
            one shared environment.
          </p>
        </div>

        <div className="lp-speed-grid">
          <article>
            <span className="lp-speed-icon" aria-hidden="true">
              <FlaskConical size={18} strokeWidth={1.8} />
            </span>
            <h3>Watch the work happen</h3>
            <p>
              Follow agent activity, inspect changed files, and check Git status
              while the agent works.
            </p>
          </article>
          <article>
            <span className="lp-speed-icon" aria-hidden="true">
              <MessagesSquare size={18} strokeWidth={1.8} />
            </span>
            <h3>Keep the context shared</h3>
            <p>
              Teammates can join the same workspace, follow the conversation,
              and guide the agent together.
            </p>
          </article>
          <article>
            <span className="lp-speed-icon" aria-hidden="true">
              <GitBranch size={18} strokeWidth={1.8} />
            </span>
            <h3>Work in one environment</h3>
            <p>
              The editor, terminal, Git panel, and agent all address the same
              workspace filesystem.
            </p>
          </article>
        </div>
      </section>

      <section className="lp-contrast" data-reveal>
        <article className="lp-contrast-before">
          <span>Everywhere else</span>
          <p>
            One person prompts in a private chat. Everyone else waits for a pull
            request and re-reads a transcript to catch up.
          </p>
        </article>
        <article className="lp-contrast-after">
          <span>In CoDev</span>
          <p>
            Everyone can join the same live workspace, follow the conversation,
            inspect changes, and steer the agent with the same context.
          </p>
        </article>
      </section>

      <section className="lp-request" data-reveal>
        <h2>Ready to build in the same room?</h2>
        <p>Join the private beta. All we need is your email.</p>
        <WaitlistInline />
      </section>

      <footer className="lp-footer">
        <Link className="lp-brand" href="/" aria-label="CoDev home">
          <Image src="/brand/codev-mark.svg" alt="" width={26} height={26} />
          <span>CoDev</span>
        </Link>
        <p>People and agents, building in the same room.</p>
        <nav aria-label="Footer">
          <Link href="/pricing">Pricing</Link>
          <Link href="/sign-in">Sign in</Link>
          <Link href="/legal/privacy">Privacy</Link>
          <Link href="/legal/terms">Terms</Link>
          <Link href="/legal/refunds">Refunds & cancellation</Link>
          <Link href="/legal/retention">Data retention</Link>
        </nav>
      </footer>
    </main>
  );
}
