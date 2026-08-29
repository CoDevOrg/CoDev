import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LandingMotion } from "@/components/landing-motion";
import { LandingWorkspaceDemo } from "@/components/landing-workspace-demo";
import { RequestAccessForm } from "@/components/request-access-form";
import { getCurrentAppUser } from "@/lib/identity";

import "./landing.css";

export const metadata: Metadata = {
  title: "Build together, with agents",
  description:
    "CoDev is a shared cloud workspace where you, your friends, and a crew of AI agents build the same project at the same time. Request access to the private beta.",
};

const steps = [
  ["Request access", "Tell us who you are and what you're building."],
  ["We email you", "A confirmation now, an invite when the next group opens."],
  ["Open a workspace", "Connect a repo and pull everyone in with one link."],
] as const;

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
          <Link href="/sign-in">Sign in</Link>
          <a className="lp-cta lp-cta-small" href="#request">
            Request access
          </a>
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
          <a className="lp-cta lp-cta-primary" href="#request">
            Request access
          </a>
          <Link className="lp-cta lp-cta-ghost" href="/sign-in">
            I have an invite
          </Link>
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
        </ul>
      </section>

      <section className="lp-tour" id="tour" data-reveal>
        <LandingWorkspaceDemo />
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

      <section className="lp-request" id="request" data-reveal>
        <div className="lp-request-copy">
          <p className="lp-pill lp-pill-quiet">Private beta</p>
          <h2>
            Get your crew
            <br />
            <em>an early invite.</em>
          </h2>
          <p>
            CoDev isn&apos;t finished yet, so we&apos;re opening it to a small
            group of builders at a time: friends shipping a side project,
            students, and tiny startup teams.
          </p>
          <ol className="lp-steps">
            {steps.map(([title, copy], index) => (
              <li key={title}>
                <span>0{index + 1}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{copy}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="lp-request-form">
          <RequestAccessForm />
        </div>
      </section>

      <footer className="lp-footer">
        <Link className="lp-brand" href="/" aria-label="CoDev home">
          <Image src="/brand/codev-mark-v3.png" alt="" width={26} height={26} />
          <span>CoDev</span>
        </Link>
        <p>People and agents, building in the same room.</p>
        <nav aria-label="Legal">
          <Link href="/legal/privacy">Privacy</Link>
          <Link href="/legal/retention">Data retention</Link>
        </nav>
      </footer>
    </main>
  );
}
