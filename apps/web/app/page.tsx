import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FlaskConical, GitBranch, MessagesSquare } from "lucide-react";

import { LandingMotion } from "@/components/landing-motion";
import { LandingWorkspaceDemo } from "@/components/landing-workspace-demo";
import { RequestAccessButton } from "@/components/request-access-button";
import { WaitlistInline } from "@/components/waitlist-inline";
import { getCurrentAppUser } from "@/lib/identity";

import "./landing.css";

export const metadata: Metadata = {
  title: "Build together, with agents",
  description:
    "CoDev is a shared cloud workspace where you, your friends, and a crew of AI agents build the same project at the same time, helping teams ship up to 50% faster. Request access to the private beta.",
};

export default async function HomePage() {
  if (await getCurrentAppUser()) {
    redirect("/dashboard");
  }

  return (
    <main className="lp-page">
      <LandingMotion />

      <div className="lp-backdrop" aria-hidden="true">
        <div className="lp-mark" />
        <div className="lp-aurora lp-aurora-a" />
        <div className="lp-aurora lp-aurora-b" />
        <div className="lp-aurora lp-aurora-c" />
        <div className="lp-grid" />
        <div className="lp-grain" />
      </div>

      <header className="lp-nav">
        <Link className="lp-brand" href="/" aria-label="CoDev home">
          <Image
            src="/brand/codev-mark-v3.png"
            alt=""
            width={32}
            height={32}
            priority
          />
          <span>CoDev</span>
        </Link>
        <nav aria-label="Primary">
          <a href="#tour">How it works</a>
          <RequestAccessButton className="lp-cta lp-cta-small">
            Get early access
          </RequestAccessButton>
        </nav>
      </header>

      <section className="lp-hero">
        <p className="lp-pill">
          <i aria-hidden="true" /> Private beta · now inviting builders
        </p>
        <h1>
          Ship it together.
          <br />
          <em>Agents included.</em>
        </h1>
        <p className="lp-lede">
          CoDev is one shared cloud workspace where you, your friends, and a
          crew of AI agents build the same project at the same time, live, in
          the same room, and never on top of each other.
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
            <strong>0 conflicts</strong>
            <span>when the worktrees merge</span>
          </li>
          <li>
            <strong>1 link</strong>
            <span>to bring anyone in</span>
          </li>
          <li>
            <strong>50% faster</strong>
            <span>from idea to merged code</span>
          </li>
        </ul>
      </section>

      <section className="lp-tour" id="tour" data-reveal>
        <LandingWorkspaceDemo />
      </section>

      <section
        className="lp-speed"
        aria-labelledby="lp-speed-title"
        data-reveal
      >
        <div className="lp-speed-heading">
          <p className="lp-speed-kicker">The speed advantage</p>
          <h2 id="lp-speed-title">
            Ship up to <em>50% faster.</em>
          </h2>
          <p>
            CoDev removes the waiting and rework between writing code and
            getting it safely merged.
          </p>
        </div>

        <div className="lp-speed-grid">
          <article>
            <span className="lp-speed-icon" aria-hidden="true">
              <FlaskConical size={18} strokeWidth={1.8} />
            </span>
            <h3>Test before merge</h3>
            <p>
              Run and review a teammate&apos;s in-progress work before a commit,
              push, or merge.
            </p>
          </article>
          <article>
            <span className="lp-speed-icon" aria-hidden="true">
              <MessagesSquare size={18} strokeWidth={1.8} />
            </span>
            <h3>Coordinate, don&apos;t duplicate</h3>
            <p>
              Agents see the same live context, divide the work, and stop
              repeating the same investigation.
            </p>
          </article>
          <article>
            <span className="lp-speed-icon" aria-hidden="true">
              <GitBranch size={18} strokeWidth={1.8} />
            </span>
            <h3>Prevent conflicts early</h3>
            <p>
              Shared awareness and isolated worktrees reveal overlap before it
              becomes merge-day rework.
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
            Everyone is inside the same running workspace, watching the same
            agents, steering the same work, with nothing to reconstruct.
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
          <Image src="/brand/codev-mark-v3.png" alt="" width={26} height={26} />
          <span>CoDev</span>
        </Link>
        <p>People and agents, building in the same room.</p>
        <nav aria-label="Footer">
          <Link href="/sign-in">Sign in</Link>
          <Link href="/legal/privacy">Privacy</Link>
          <Link href="/legal/retention">Data retention</Link>
        </nav>
      </footer>
    </main>
  );
}
