"use client";

import { Check, Flame, Handshake, ShieldCheck } from "lucide-react";

export function CoordinationCard() {
  return (
    <div
      className="lp-triple-card"
      data-reveal
      style={{ "--delay": "100ms" } as React.CSSProperties}
    >
      <div className="lp-triple-text">
        <h3 className="lp-triple-title">Keep your team’s agents in sync.</h3>{" "}
        <p className="lp-triple-desc">
          Agents divide tasks and agree on who works on each file. They build in
          parallel without duplicating work or editing over each other.
        </p>
      </div>

      <div className="lp-feature-preview">
        <div className="lp-feature-dots" aria-hidden="true" />
        <div className="lp-triple-stage lp-stage-coord">
          <div className="lp-coord-topbar">
            <div className="lp-coord-brand">
              <ShieldCheck size={12} className="text-emerald-400" />
              <span>Work assignments</span>
            </div>
            <span className="lp-coord-badge-zero">No overlapping files</span>
          </div>

          <div className="lp-coord-canvas">
            {/* Agent Alpha */}
            <div className="lp-coord-lane">
              <div className="lp-coord-lane-head">
                <span className="lp-coord-dot dot-alpha" />
                <strong>Agent 1 · Claude</strong>
                <span className="lp-coord-tag">auth/session.ts</span>
              </div>
              <code className="lp-lane-code">
                Claude: I’ll handle session logic.
              </code>
              <div className="lp-lane-progress" />
            </div>

            {/* Agents agree on separate file ownership before working. */}
            <div className="lp-coord-bridge">
              <div className="lp-bridge-glow-line" />
              <div className="lp-bridge-bubble">
                <Handshake size={11} className="text-emerald-400" />
                <span>Tasks divided · files claimed</span>
              </div>
              <div className="lp-bridge-glow-line" />
            </div>

            {/* Agent Beta */}
            <div className="lp-coord-lane">
              <div className="lp-coord-lane-head">
                <span className="lp-coord-dot dot-beta" />
                <strong>Agent 2 · Codex</strong>
                <span className="lp-coord-tag">test/session.test.ts</span>
              </div>
              <code className="lp-lane-code">
                Codex: I’ll take the session tests.
              </code>
              <div className="lp-lane-progress" />
            </div>
          </div>

          <div className="lp-coord-footer">
            <Check size={11} className="text-emerald-400" />
            <span>Separate files. No duplicate work. No conflicts.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function InstantMergeCard() {
  return (
    <div
      className="lp-triple-card"
      data-reveal
      style={{ "--delay": "200ms" } as React.CSSProperties}
    >
      <div className="lp-triple-text">
        <h3 className="lp-triple-title">Review changes as they happen.</h3>{" "}
        <p className="lp-triple-desc">
          Your teammate can review your changes on the same localhost as you,
          without a commit or push. Check the results and apply updates to your
          live workspace without switching tools.
        </p>
      </div>

      <div className="lp-feature-preview">
        <div className="lp-feature-dots" aria-hidden="true" />
        <div className="lp-triple-stage lp-stage-merge">
          <div className="lp-merge-topbar">
            <span className="lp-merge-file">src/api/checkout.ts</span>
            <span className="lp-merge-diff-pills">
              <span className="diff-add">+18</span>
              <span className="diff-del">-2</span>
            </span>
          </div>

          <div className="lp-merge-snippet">
            <div className="lp-merge-row del">
              <span className="ln">24</span>
              <span>- const timeout = 10000;</span>
            </div>
            <div className="lp-merge-row add">
              <span className="ln">24</span>
              <span>+ const timeout = getAdaptiveWindow();</span>
            </div>
          </div>

          <div className="lp-merge-action-wrap">
            <div className="lp-live-apply-btn">
              <span className="lp-apply-ready">
                <Flame size={12} /> Apply to Live Room
              </span>
              <span className="lp-apply-done">
                <Check size={12} /> Applied to Room
              </span>
            </div>
            <div className="lp-pointer-cursor" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                <path
                  d="M4 3l7 18 3-7 7-3L4 3z"
                  fill="white"
                  stroke="#060a17"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>

          <div className="lp-merge-footer">
            <span className="lp-test-ok">
              <span className="lp-tests-running">Running checkout tests…</span>
              <span className="lp-tests-passed">
                ✓ 14 tests passed · ready to apply
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
