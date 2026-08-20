"use client";

import Link from "next/link";
import { useState } from "react";

type AudienceKey = "builders" | "companies";

const audienceContent = {
  builders: {
    label: "For builders",
    title: "Build the idea together.",
    accent: "See every move.",
    copy: "A shared place for friends, students, open source contributors, and small teams to build with AI without losing each other in separate tools.",
    groups: ["Friends", "Students", "Open source", "Small teams"],
    action: "Start building together",
    benefits: [
      {
        number: "01",
        title: "Share the whole workspace",
        copy: "Open the same repository, files, terminal, and agent sessions from any browser.",
      },
      {
        number: "02",
        title: "See changes as they happen",
        copy: "Follow local edits and active work before anyone commits, pushes, or publishes.",
      },
      {
        number: "03",
        title: "Create without stepping on each other",
        copy: "Know what teammates and agents are handling so everyone can focus on a useful part.",
      },
    ],
    useCases: [
      "Ship a side project with friends",
      "Build and learn with classmates",
      "Coordinate an open source contribution",
    ],
  },
  companies: {
    label: "For companies",
    title: "Make AI work visible.",
    accent: "Keep engineering in control.",
    copy: "A shared execution layer for startups and engineering organizations that need people and agents to work with clear ownership, continuous review, and complete context.",
    groups: ["Startups", "Engineering", "Platform", "Security"],
    action: "Start a company pilot",
    benefits: [
      {
        number: "01",
        title: "Prevent duplicate work",
        copy: "See active ownership, overlapping changes, and related investigations before time is wasted.",
      },
      {
        number: "02",
        title: "Review before work compounds",
        copy: "Let senior engineers inspect assumptions, agent activity, tests, and changes while direction is still easy to adjust.",
      },
      {
        number: "03",
        title: "Preserve the complete handoff",
        copy: "Continue with the same code, runtime, sessions, decisions, and unfinished work across teams and time zones.",
      },
    ],
    useCases: [
      "Coordinate teams adopting coding agents",
      "Guide incidents and complex investigations",
      "Govern agent access, activity, and review",
    ],
  },
} as const;

const companyUseCases = [
  {
    number: "01",
    category: "Product delivery",
    title: "A room for every engineering task",
    copy: "Keep the repository, runtime, people, agents, decisions, tests, and review together from the first prompt to the final merge.",
  },
  {
    number: "02",
    category: "Team coordination",
    title: "Prevent duplicate work",
    copy: "Make ownership and active changes visible before two engineers or agents spend time solving the same problem.",
  },
  {
    number: "03",
    category: "Agent operations",
    title: "Coordinate parallel agents",
    copy: "Give investigation, implementation, testing, and review agents clear responsibilities without silent collisions.",
  },
  {
    number: "04",
    category: "Incident response",
    title: "Investigate in one shared room",
    copy: "Bring responders, relevant code, agent findings, hypotheses, and decisions into the same controlled environment.",
  },
  {
    number: "05",
    category: "Engineering quality",
    title: "Review continuously",
    copy: "Let senior engineers challenge assumptions and redirect work while changes are still easy to improve.",
  },
  {
    number: "06",
    category: "Distributed teams",
    title: "Hand work across time zones",
    copy: "Continue with the same code, runtime, agent history, decisions, test state, and unresolved questions.",
  },
  {
    number: "07",
    category: "Company programs",
    title: "Coordinate large migrations",
    copy: "Keep related repository work visible so teams can reuse successful patterns and spot shared blockers.",
  },
  {
    number: "08",
    category: "Security",
    title: "Control sensitive remediation",
    copy: "Give authorized participants a restricted environment with visible agent activity, review, and evidence.",
  },
  {
    number: "09",
    category: "Customer trust",
    title: "Resolve escalations together",
    copy: "Connect support and engineering around one reproducible issue, clear ownership, and a complete resolution history.",
  },
] as const;

const companyRoles = [
  {
    role: "Developers",
    value:
      "See ownership, active changes, and agent findings without another status meeting.",
  },
  {
    role: "Senior engineers",
    value: "Guide more work early without taking over every task.",
  },
  {
    role: "Engineering managers",
    value: "Understand progress, blockers, overlapping work, and handoff risk.",
  },
  {
    role: "Platform and security",
    value:
      "Give agent adoption a visible, controlled, and reviewable workspace.",
  },
] as const;

export function LandingAudience() {
  const [audience, setAudience] = useState<AudienceKey>("builders");
  const content = audienceContent[audience];

  return (
    <section className="landing-audience" id="for-you">
      <div className="landing-audience-intro">
        <div>
          <p className="landing-audience-overline">Choose your view</p>
          <h2>One product. Built around the way your team works.</h2>
        </div>
        <div
          className="landing-audience-switch"
          role="group"
          aria-label="Choose who CoDev is for"
        >
          <button
            type="button"
            aria-pressed={audience === "builders"}
            className={audience === "builders" ? "is-active" : undefined}
            onClick={() => setAudience("builders")}
          >
            Builders
            <small>People and small teams</small>
          </button>
          <button
            type="button"
            aria-pressed={audience === "companies"}
            className={audience === "companies" ? "is-active" : undefined}
            onClick={() => setAudience("companies")}
          >
            Companies
            <small>Startups and organizations</small>
          </button>
        </div>
      </div>

      <div
        className="landing-audience-panel"
        id="audience-panel"
        aria-live="polite"
        data-audience={audience}
      >
        <div className="landing-audience-heading">
          <div>
            <p className="landing-audience-kicker">{content.label}</p>
            <h3>
              {content.title}
              <br />
              <em>{content.accent}</em>
            </h3>
          </div>
          <div className="landing-audience-summary">
            <p>{content.copy}</p>
            <div className="landing-audience-groups">
              {content.groups.map((group) => (
                <span key={group}>{group}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="landing-audience-benefits">
          {content.benefits.map((benefit) => (
            <article key={benefit.number}>
              <span>{benefit.number}</span>
              <h4>{benefit.title}</h4>
              <p>{benefit.copy}</p>
            </article>
          ))}
        </div>

        <div className="landing-audience-footer">
          <div>
            <span>Built for real work</span>
            <ul>
              {content.useCases.map((useCase) => (
                <li key={useCase}>
                  <i aria-hidden="true">✓</i>
                  {useCase}
                </li>
              ))}
            </ul>
          </div>
          <Link className="landing-audience-action" href="/sign-in">
            {content.action} <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </div>

      {audience === "companies" ? (
        <div className="landing-company-story">
          <section className="landing-company-use-cases">
            <div className="landing-company-section-heading">
              <div>
                <p>Use CoDev across engineering</p>
                <h3>
                  One shared way to work.
                  <br />
                  <em>Many company use cases.</em>
                </h3>
              </div>
              <p>
                CoDev starts with the engineering task and expands naturally
                wherever people and agents need shared context, clear ownership,
                and continuous review.
              </p>
            </div>

            <div className="landing-company-case-grid">
              {companyUseCases.map((useCase) => (
                <article key={useCase.number}>
                  <div>
                    <span>{useCase.number}</span>
                    <small>{useCase.category}</small>
                  </div>
                  <h4>{useCase.title}</h4>
                  <p>{useCase.copy}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="landing-company-seats">
            <div className="landing-company-seats-copy">
              <p>Why every seat matters</p>
              <h3>
                The value grows when the
                <br />
                <em>whole team shares the room.</em>
              </h3>
              <p>
                CoDev is not another private assistant. Each person who joins
                makes active work easier to discover, review, continue, and
                coordinate across the company.
              </p>
            </div>
            <div className="landing-company-role-list">
              {companyRoles.map((item, index) => (
                <article key={item.role}>
                  <span>0{index + 1}</span>
                  <div>
                    <h4>{item.role}</h4>
                    <p>{item.value}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="landing-company-outcomes">
            <div className="landing-company-section-heading">
              <div>
                <p>The business case</p>
                <h3>
                  Buy less invisible work.
                  <br />
                  <em>Get more shared progress.</em>
                </h3>
              </div>
              <p>
                Company wide adoption creates one source of truth for work that
                is otherwise scattered across laptops, chats, branches, and
                private agent sessions.
              </p>
            </div>
            <div className="landing-company-outcome-grid">
              <article>
                <span>Less</span>
                <h4>Duplicate investigation</h4>
                <p>Discover related work before people repeat it.</p>
              </article>
              <article>
                <span>Earlier</span>
                <h4>Engineering review</h4>
                <p>Correct direction before a large rewrite is needed.</p>
              </article>
              <article>
                <span>Faster</span>
                <h4>Team handoffs</h4>
                <p>Continue from the real state instead of a summary.</p>
              </article>
              <article>
                <span>Clearer</span>
                <h4>Agent oversight</h4>
                <p>
                  Understand who started work, what changed, and what shipped.
                </p>
              </article>
            </div>
          </section>

          <section className="landing-company-cta">
            <div>
              <p>Bring everyone into the same room</p>
              <h3>
                Give your engineering organization a shared way to build with
                AI.
              </h3>
            </div>
            <Link href="/sign-in">
              Start a company pilot <span aria-hidden="true">↗</span>
            </Link>
          </section>
        </div>
      ) : null}
    </section>
  );
}
