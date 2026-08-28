"use client";

import { useEffect, useState } from "react";

type FeedEvent = {
  who: string;
  what: string;
  t: string;
  ai?: boolean;
};

const script: readonly FeedEvent[] = [
  {
    who: "Sarah",
    what: "Rewrite this so a customer can understand it",
    t: "2:41",
  },
  {
    who: "AI",
    what: "Drafted a shorter version — 3 clauses cut",
    t: "2:41",
    ai: true,
  },
  { who: "David", what: "Keep the 30-day window, legal needs it", t: "2:42" },
  {
    who: "AI",
    what: "Put it back. Everything else stays plain.",
    t: "2:42",
    ai: true,
  },
  { who: "Alex", what: "Joined and read the room", t: "2:43" },
];

export function WorkspacePreview() {
  // Render the full feed for SSR / no-JS / reduced motion; the effect replays it.
  const [shown, setShown] = useState(script.length);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let count = 0;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      count = count >= script.length ? 0 : count + 1;
      setShown(count);
      timer = setTimeout(tick, count === script.length ? 4200 : 1600);
    };

    timer = setTimeout(tick, 400);
    return () => clearTimeout(timer);
  }, []);

  const [copied, setCopied] = useState(false);
  const shareLink = "codev.com/r/refund-policy";

  const copy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(shareLink).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="roomwrap">
      <div className="card room">
        <div className="room-bar">
          <div>
            <div className="room-title">Refund policy rewrite</div>
            <div className="room-sub">A room · 3 people · 1 AI</div>
          </div>
          <div className="faces">
            <div className="stack">
              <div className="av av-2">S</div>
              <div className="av av-1">D</div>
              <div className="av av-3">A</div>
            </div>
            <button className="share-btn" type="button" tabIndex={-1}>
              <svg
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M6.5 9.5l3-3M7 4.5l1.2-1.2a2.6 2.6 0 013.7 3.7L10.7 8.2M9 11.5l-1.2 1.2a2.6 2.6 0 01-3.7-3.7L5.3 7.8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              Share
            </button>
          </div>
        </div>

        <div className="feed" aria-label="A live CoDev room">
          {script.slice(0, shown).map((e, index) => (
            <div
              className={`evt${index === shown - 1 ? " fresh" : ""}`}
              key={`${e.who}-${index}`}
            >
              <span className={`who${e.ai ? " ai" : ""}`}>{e.who}</span>
              <span className="what">{e.what}</span>
              <span className="time">{e.t}</span>
            </div>
          ))}
        </div>

        <div className="room-foot">
          <span className="pill">
            <span className="dot live" />
            Live
          </span>
          <span>Sarah, David and Alex are in this room right now</span>
        </div>
      </div>

      <div className="share-menu">
        <h5>Share this room</h5>
        <div className="share-link">
          <span>
            codev.com<span className="path">/r/refund-policy</span>
          </span>
          <button className="copy-btn" type="button" onClick={copy}>
            {copied ? "copied" : "Copy"}
          </button>
        </div>
        <div className="share-row">
          <span className="who">
            <span className="av av-3 av-sm">A</span> Alex
          </span>
          <select aria-label="Alex's access" defaultValue="Can edit">
            <option>Can edit</option>
            <option>Can view</option>
          </select>
        </div>
        <div className="share-row">
          <span className="who">
            <span className="av av-1 av-sm">+</span> Anyone with the link
          </span>
          <select aria-label="Link access" defaultValue="Can view">
            <option>Can view</option>
            <option>Can edit</option>
          </select>
        </div>
        <p className="share-hint">
          They don&apos;t need an account, a setup, or an AI subscription of
          their own.
        </p>
      </div>
    </div>
  );
}
