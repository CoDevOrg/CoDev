"use client";

import { MultiplayerCard } from "./multiplayer-card";
import { TerminalCard } from "./terminal-card";
import "./feature-previews.css";

import { CoordinationCard, InstantMergeCard } from "./how-it-works-cards";

export function HowItWorks() {
  return (
    <section
      className="lp-how"
      id="tour"
      aria-labelledby="lp-how-title"
      data-reveal
    >
      <div className="lp-how-header">
        <h2 id="lp-how-title" className="lp-how-title">
          One workspace. Your team. Your agents.
        </h2>
        <p className="lp-how-subtitle">
          People and AI agents in one running workspace. Everything happens
          live.
        </p>
      </div>

      <div className="lp-triple-grid">
        <MultiplayerCard />
        <CoordinationCard />
        <InstantMergeCard />
        <TerminalCard />
      </div>
    </section>
  );
}
