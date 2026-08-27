"use client";

import Link from "next/link";
import { useState } from "react";

type AudienceKey = "individuals" | "companies";

const views = {
  individuals: {
    kicker: "FOR INDIVIDUALS & SMALL TEAMS",
    title: "Share the work, not just the output.",
    copy: "Open a room for a project or investigation. Invite the people you trust, give agents clear tasks, and keep every branch visible.",
    action: "Start a workspace",
    points: [
      [
        "01",
        "Work side by side",
        "See what people and agents are doing as it happens.",
      ],
      [
        "02",
        "Branch without chaos",
        "Explore different approaches without losing the main thread.",
      ],
      [
        "03",
        "Pick up instantly",
        "Return to the full state—not a pasted summary.",
      ],
    ],
    signal: "2 people · 3 agents",
    room: "Launch investigation",
  },
  companies: {
    kicker: "FOR COMPANIES",
    title: "Make consequential AI work accountable.",
    copy: "Give teams one controlled place to coordinate agents, review evidence, approve actions, and preserve the decisions behind the outcome.",
    action: "Start a company pilot",
    points: [
      [
        "01",
        "Clear ownership",
        "Assign collaborators, agent controllers, and approvers.",
      ],
      [
        "02",
        "Review in context",
        "Inspect evidence and agent activity before decisions compound.",
      ],
      [
        "03",
        "A complete record",
        "Keep handoffs, permissions, approvals, and history together.",
      ],
    ],
    signal: "8 people · 6 agents",
    room: "Customer escalation",
  },
} as const;

export function LandingAudience() {
  const [audience, setAudience] = useState<AudienceKey>("individuals");
  const view = views[audience];

  return (
    <section className="mp-audience" id="for-you">
      <div className="mp-audience-top">
        <div>
          <p>CHOOSE YOUR VIEW</p>
          <h2>
            One shared workspace.
            <br />
            <em>Built for how you work.</em>
          </h2>
        </div>
        <div
          className="mp-audience-switch"
          role="group"
          aria-label="Choose who CoDev is for"
        >
          <button
            type="button"
            aria-pressed={audience === "individuals"}
            onClick={() => setAudience("individuals")}
          >
            Individuals <small>& small teams</small>
          </button>
          <button
            type="button"
            aria-pressed={audience === "companies"}
            onClick={() => setAudience("companies")}
          >
            Companies <small>& organizations</small>
          </button>
        </div>
      </div>

      <div
        className="mp-audience-panel"
        data-audience={audience}
        aria-live="polite"
      >
        <div className="mp-audience-copy">
          <p>{view.kicker}</p>
          <h3>{view.title}</h3>
          <span>{view.copy}</span>
          <Link href="/sign-in">
            {view.action} <b>↗</b>
          </Link>
        </div>
        <div className="mp-audience-points">
          {view.points.map(([number, title, copy]) => (
            <article key={number}>
              <span>{number}</span>
              <div>
                <h4>{title}</h4>
                <p>{copy}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="mp-audience-mini-room">
          <div>
            <span>
              <i /> LIVE ROOM
            </span>
            <b>{view.signal}</b>
          </div>
          <h4>{view.room}</h4>
          <div className="mp-mini-timeline">
            <i />
            <i />
            <i />
          </div>
          <p>
            <span>AI</span> Agent work is visible to everyone
          </p>
          <p>
            <span>✓</span> Decision recorded with an owner
          </p>
          <small>Full context ready for handoff</small>
        </div>
      </div>
    </section>
  );
}
