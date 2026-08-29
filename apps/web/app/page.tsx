import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LandingWorkspaceDemo } from "@/components/landing-workspace-demo";
import { RequestAccessForm } from "@/components/request-access-form";
import { getCurrentAppUser } from "@/lib/identity";

import "./landing.css";

export const metadata: Metadata = {
  title: "Three agents. One file. Every move visible.",
  description:
    "CoDev is a hosted browser workspace where your team can watch, guide, and review multiple coding agents in one shared room.",
};

export default async function HomePage() {
  if (await getCurrentAppUser()) redirect("/dashboard");

  return (
    <main className="lp-page">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <Link className="lp-brand" href="/" aria-label="CoDev home">
            <Image
              src="/brand/codev-mark-v3.png"
              alt=""
              width={30}
              height={30}
              priority
            />
            <span>CoDev</span>
          </Link>
          <nav aria-label="Primary">
            <a href="#demo">See it work</a>
            <a href="#why">Why CoDev</a>
            <Link href="/sign-in">Sign in</Link>
            <a className="lp-button lp-button-small" href="#request">
              Request access
            </a>
          </nav>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-inner">
          <p className="lp-beta">
            <i aria-hidden="true" /> Private beta · inviting builders now
          </p>
          <h1>
            Three agents.
            <br />
            One file.
            <br />
            <em>Every move visible.</em>
          </h1>
          <p className="lp-lede">
            CoDev is a hosted browser workspace where your team can watch,
            guide, and review several coding agents in one shared room.
          </p>
          <div className="lp-hero-actions">
            <a className="lp-button lp-button-primary" href="#request">
              Request beta access <span aria-hidden="true">↗</span>
            </a>
            <Link className="lp-button lp-button-secondary" href="/sign-in">
              I have an invite
            </Link>
          </div>
          <p className="lp-hero-note">
            Your repository, people, agents, terminal, and history — together in
            the browser.
          </p>
        </div>
      </section>

      <section className="lp-demo-section" id="demo">
        <div className="lp-section-heading" data-reveal>
          <p>Watch the file, not three private chats.</p>
          <h2>See the work happen together.</h2>
          <span>
            Named cursors show who is changing what. The agent rail keeps every
            task and status visible without leaving the editor.
          </span>
        </div>
        <div data-reveal>
          <LandingWorkspaceDemo />
        </div>
      </section>

      <section className="lp-story" id="why">
        <article className="lp-story-row" data-reveal>
          <div className="lp-story-copy">
            <span className="lp-story-number">01</span>
            <h2>Every cursor has a name.</h2>
            <p>
              Follow each agent from assignment to edit. You always know which
              model is active, where it is working, and what it intends to
              change.
            </p>
          </div>
          <div
            className="lp-presence-artifact"
            aria-label="Named agent cursor example"
          >
            <div className="lp-artifact-file">
              <span>reserve.ts</span>
              <b>3 editing</b>
            </div>
            <pre>
              <code>{`const cart = checkoutSchema.parse(input);
const lock = await claim(cart.id);
return commit(cart, lock);`}</code>
            </pre>
            <i className="lp-artifact-cursor lp-artifact-orange">Codex</i>
            <i className="lp-artifact-cursor lp-artifact-green">Claude</i>
            <i className="lp-artifact-cursor lp-artifact-purple">Review</i>
          </div>
        </article>

        <article className="lp-story-row lp-story-row-reverse" data-reveal>
          <div className="lp-story-copy">
            <span className="lp-story-number">02</span>
            <h2>One result to review.</h2>
            <p>
              Tests, agent status, and the combined change resolve in the same
              workspace, so your team can steer the work before it is ready to
              ship.
            </p>
          </div>
          <div
            className="lp-review-artifact"
            aria-label="Ready for review example"
          >
            <div>
              <i>
                <span>✓</span>
              </i>
              <p>
                <strong>Ready for review</strong>
                <small>src/checkout/reserve.ts</small>
              </p>
            </div>
            <dl>
              <div>
                <dt>Agents</dt>
                <dd>3 complete</dd>
              </div>
              <div>
                <dt>Tests</dt>
                <dd>42 passed</dd>
              </div>
              <div>
                <dt>Review</dt>
                <dd>Waiting on you</dd>
              </div>
            </dl>
          </div>
        </article>
      </section>

      <section className="lp-room" data-reveal>
        <div>
          <p>One shared room</p>
          <h2>
            No transcript archaeology.
            <br />
            No guessing who changed what.
          </h2>
          <span>
            Invite your team with one link. They arrive in the running workspace
            with the repository, agent history, and current work already in
            view.
          </span>
        </div>
      </section>

      <section className="lp-request" id="request">
        <div className="lp-request-inner" data-reveal>
          <div className="lp-request-copy">
            <p className="lp-beta lp-beta-dark">
              <i aria-hidden="true" /> Private beta
            </p>
            <h2>Bring your whole crew into one room.</h2>
            <p>
              We are opening CoDev to small groups of builders at a time. Tell
              us what you are working on and we will email you when your invite
              is ready.
            </p>
          </div>
          <div className="lp-request-form">
            <RequestAccessForm />
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <div>
          <Link className="lp-brand" href="/" aria-label="CoDev home">
            <Image
              src="/brand/codev-mark-v3.png"
              alt=""
              width={26}
              height={26}
            />
            <span>CoDev</span>
          </Link>
          <p>People and agents, building in the same room.</p>
          <nav aria-label="Legal">
            <Link href="/legal/privacy">Privacy</Link>
            <Link href="/legal/retention">Data retention</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
