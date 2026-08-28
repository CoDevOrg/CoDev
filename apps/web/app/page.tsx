import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Brand } from "@/components/app-chrome";
import { WorkspacePreview } from "@/components/landing-workspace-preview";
import { getCurrentAppUser } from "@/lib/identity";

export const metadata: Metadata = {
  title: "Use AI together",
  description:
    "CoDev turns your AI session into a room you can share with a link. Your team clicks it, sees everything live, and works on it with you.",
};

const steps = [
  [
    "01",
    "Open a room",
    "One room per thing you're working on. The AI lives in it with you.",
  ],
  [
    "02",
    "Share it like a doc",
    "Hit Share, send the link. Whoever opens it sees the room live — no setup, no account, no AI subscription.",
  ],
  [
    "03",
    "Work on it together",
    "Watch what the AI does, jump in, take over, hand it off. It all stays in the room.",
  ],
] as const;

export default async function HomePage() {
  if (await getCurrentAppUser()) redirect("/dashboard");

  return (
    <main className="mp-page">
      <div className="wrap">
        <nav>
          <Brand />
          <div className="links">
            <a href="#how">How it works</a>
            <Link href="/sign-in">Sign in</Link>
            <Link className="btn small" href="/sign-in">
              Request access
            </Link>
          </div>
        </nav>

        <section className="hero">
          <div>
            <h1>
              Use AI <em className="say">together.</em>
            </h1>
            <p className="lede">
              CoDev turns your AI session into a room you can share with a link
              — the same way you&apos;d share a document. Your team clicks it,
              sees everything live, and works on it with you.
            </p>
            <div className="cta-row">
              <Link className="btn" href="/sign-in">
                Request access
              </Link>
              <span className="cta-note">
                Have an invite? <Link href="/sign-in">Sign in</Link>.
              </span>
            </div>
            <p className="capacity">
              Open to a small group of teams today. Everyone else joins as we
              add room.
            </p>
          </div>

          <div>
            <WorkspacePreview />
            <p className="caption">
              Paste the link anywhere. Whoever opens it is in the room, watching
              it happen.
            </p>
          </div>
        </section>
      </div>

      <div className="wrap" id="how">
        <div className="strip-head">
          <h2>
            Three things, <em className="say">that&apos;s all.</em>
          </h2>
        </div>
        <div className="steps">
          {steps.map(([number, title, copy]) => (
            <div className="step" key={number}>
              <span className="n">{number}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </div>
          ))}
        </div>

        <div className="band">
          <div>
            <p>
              Someone joins an hour late and reads the room instead of asking
              you to explain it again. That&apos;s the whole idea.
            </p>
            <p className="who">
              Works with Claude, GPT and Gemini. You don&apos;t have to pick.
            </p>
          </div>
          <p className="quote">Nobody had to re-explain anything.</p>
        </div>
      </div>

      <div className="wrap" id="access">
        <section className="access">
          <div>
            <h2>
              We&apos;re letting teams in <em className="say">gradually.</em>
            </h2>
            <p className="lede" style={{ marginTop: 14 }}>
              Leave your email and we&apos;ll get you in.
            </p>
          </div>
          <form action="/sign-in" method="get">
            <input
              type="email"
              name="email"
              placeholder="you@company.com"
              aria-label="Work email"
            />
            <button className="btn" type="submit">
              Request access
            </button>
            <p className="formnote">
              Already invited? <Link href="/sign-in">Sign in instead</Link>.
            </p>
          </form>
        </section>

        <footer>
          <Brand />
          <span>One room for your team and its AI.</span>
          <div className="links">
            <a href="#">Docs</a>
            <a href="#">X</a>
            <a href="#">Contact</a>
            <a href="#">Privacy</a>
          </div>
        </footer>
      </div>
    </main>
  );
}
