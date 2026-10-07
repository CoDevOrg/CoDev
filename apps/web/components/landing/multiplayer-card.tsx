"use client";

import { useEffect, useState } from "react";
import { Check, Copy, MousePointer2, Share2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import "./multiplayer-preview.css";

const DURATIONS = [2200, 2400, 1800, 5500];

export function MultiplayerCard() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(
      () => setPhase((phase + 1) % 4),
      DURATIONS[phase],
    );
    return () => window.clearTimeout(timer);
  }, [phase]);

  return (
    <div className="lp-triple-card" data-reveal>
      <div className="lp-triple-text">
        <h3 className="lp-triple-title">Invite your team. Build together.</h3>{" "}
        <p className="lp-triple-desc">
          Share a link and work in the same editor and terminal. Follow each
          other’s agent sessions and see changes as they happen.
        </p>
      </div>
      <InvitePreview phase={phase} setPhase={setPhase} />
    </div>
  );
}

function InvitePreview({
  phase,
  setPhase,
}: {
  phase: number;
  setPhase: (phase: number) => void;
}) {
  return (
    <div
      className={`lp-feature-preview lp-invite-preview lp-invite-phase-${phase}`}
      aria-label="Interactive sharing preview"
    >
      <div className="lp-feature-dots" aria-hidden="true" />
      <div className="lp-triple-stage lp-invite-editor">
        <div className="lp-invite-toolbar">
          <span>workspace / api.ts</span>
          <Button variant="secondary" size="xs" onClick={() => setPhase(1)}>
            <Share2 data-icon="inline-start" />
            Share
          </Button>
        </div>
        <EditorScene joined={phase === 3} />
        <div className="lp-doc-footer">
          <span className="lp-doc-live-dot" />
          {phase === 3
            ? "3 in room · editing together"
            : "You and Claude · ready to build"}
        </div>
      </div>
      {(phase === 1 || phase === 2) && (
        <InviteLink
          copied={phase === 2}
          onCopy={() => setPhase(phase === 2 ? 3 : 2)}
        />
      )}
      <div className="lp-invite-pointer" aria-hidden="true">
        <MousePointer2 size={20} fill="white" />
      </div>
      {phase === 3 && <JoinedNotice />}
    </div>
  );
}

function JoinedNotice() {
  return (
    <div className="lp-invite-joined">
      <span className="lp-invite-avatar">S</span>
      <span>
        <strong>Sarah joined your workspace</strong>
        <small>Same files. Same terminal. Ready to build.</small>
      </span>
      <Check size={14} />
    </div>
  );
}

function InviteLink({
  copied,
  onCopy,
}: {
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="lp-invite-dialog">
      <strong>Build together</strong>
      <p>Anyone you invite can join this workspace.</p>
      <div className="lp-invite-link">
        <span>trycodev.com/room/team</span>
        <Button
          variant="secondary"
          size="icon-xs"
          aria-label={
            copied ? "Preview teammate joining" : "Try copying the demo invite"
          }
          onClick={onCopy}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
      <small>
        {copied
          ? "Link copied · waiting for your teammate…"
          : "Copy the link and send it to your teammate."}
      </small>
    </div>
  );
}

function EditorScene({ joined }: { joined: boolean }) {
  return (
    <div className="lp-invite-code">
      <div className="lp-invite-presence">
        <span className="lp-invite-avatar lp-invite-you">Y</span>
        {joined && <span className="lp-invite-avatar">S</span>}
        <span className="lp-invite-avatar lp-invite-agent">
          <Sparkles size={10} />
        </span>
        <span>{joined ? "Sarah is editing…" : "Claude is working…"}</span>
      </div>
      <div>
        <i>12</i>
        <span className="lp-invite-keyword">export async function</span>{" "}
        handle(req) &#123;
      </div>
      <div className={joined ? "lp-invite-edit-line" : ""}>
        <i>13</i>&nbsp; const ok ={" "}
        <span className="lp-invite-typed">
          {joined ? "await checkRateLimit(req.ip);" : "true;"}
        </span>
        {joined && <b className="lp-invite-caret">Sarah</b>}
      </div>
      <div>
        <i>14</i>&nbsp; return Response.json(&#123; ok &#125;);
      </div>
      <div>
        <i>15</i>&#125;
      </div>
    </div>
  );
}
