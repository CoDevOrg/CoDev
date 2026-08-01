import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Brand } from "@/components/app-chrome";
import { getCurrentAppUser } from "@/lib/identity";

export const metadata: Metadata = {
  title: "Build together",
  description:
    "CoDev brings people and AI agents into one shared workspace for building software together.",
};

const benefits = [
  {
    number: "01",
    title: "Keep the context together",
    copy: "Your repository, decisions, agent sessions, and reviews live in the same place instead of being scattered across tools and messages.",
  },
  {
    number: "02",
    title: "Share the work in progress",
    copy: "Invite teammates into the workspace, watch the same work unfold, and step in when a decision needs a human perspective.",
  },
  {
    number: "03",
    title: "Move from idea to merge",
    copy: "Turn a GitHub repository into a working space where agents can build, people can guide, and every change stays reviewable.",
  },
];

const workflow = [
  ["Connect", "Choose a GitHub repository."],
  ["Build", "Work with your team and agents."],
  ["Review", "Ship changes with confidence."],
] as const;

export default async function HomePage() {
  if (await getCurrentAppUser()) {
    redirect("/dashboard");
  }

  return (
    <main className="landing-page">
      <div className="landing-grain" aria-hidden="true" />
      <header className="landing-nav">
        <Brand />
        <nav aria-label="Primary navigation">
          <a href="#why-codev">Why CoDev</a>
          <a href="#workflow">How it works</a>
          <Link className="landing-sign-in" href="/sign-in">
            Sign in <span aria-hidden="true">↗</span>
          </Link>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="landing-eyebrow">
            <span className="landing-eyebrow-dot" />A shared workspace for
            software teams
          </p>
          <h1>
            Build software
            <br />
            <em>together.</em>
          </h1>
          <p className="landing-hero-lede">
            CoDev brings your team and AI agents into one place to plan, build,
            and review software. Less context switching. More momentum.
          </p>
          <div className="landing-hero-actions">
            <Link className="landing-primary-action" href="/sign-in">
              Start building <span aria-hidden="true">↗</span>
            </Link>
            <a className="landing-text-action" href="#why-codev">
              See why it matters <span aria-hidden="true">↓</span>
            </a>
          </div>
          <p className="landing-hero-note">
            Connect a repository. Invite your team. Keep the work moving.
          </p>
        </div>
      </section>

      <section className="landing-introduction" id="why-codev">
        <div className="landing-section-label">
          <span>Why CoDev</span>
          <span>02 — 03</span>
        </div>
        <div className="landing-introduction-grid">
          <h2>
            The best work happens when everyone can see what is happening.
          </h2>
          <p>
            Modern software is built by people, agents, and a growing set of
            tools. CoDev gives that work a shared surface: one workspace for
            understanding the problem, making changes, and deciding what ships.
          </p>
        </div>
        <div className="landing-benefits">
          {benefits.map((benefit) => (
            <article key={benefit.number}>
              <span>{benefit.number}</span>
              <h3>{benefit.title}</h3>
              <p>{benefit.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-workflow" id="workflow">
        <div className="landing-section-label">
          <span>The idea is simple</span>
          <span>03 — 03</span>
        </div>
        <div className="landing-workflow-heading">
          <h2>From repository to shared momentum.</h2>
          <p>
            CoDev keeps the workflow legible so the team can spend its energy on
            the work—not on reconstructing the context around it.
          </p>
        </div>
        <div className="landing-workflow-steps">
          {workflow.map(([title, copy], index) => (
            <div className="landing-workflow-step" key={title}>
              <span>0{index + 1}</span>
              <strong>{title}</strong>
              <p>{copy}</p>
              {index < workflow.length - 1 ? <i aria-hidden="true">→</i> : null}
            </div>
          ))}
        </div>
      </section>

      <section className="landing-cta">
        <div>
          <p className="landing-eyebrow">Make the work visible</p>
          <h2>Start with the repository you already have.</h2>
        </div>
        <Link
          className="landing-primary-action landing-primary-action-light"
          href="/sign-in"
        >
          Open CoDev <span aria-hidden="true">↗</span>
        </Link>
      </section>

      <footer className="landing-footer">
        <Brand />
        <p>People and AI agents, building in the same room.</p>
        <span>Hosted on the web</span>
      </footer>
    </main>
  );
}
