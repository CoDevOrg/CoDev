import { Terminal } from "lucide-react";

export function TerminalCard() {
  return (
    <div className="lp-triple-card" data-reveal>
      <div className="lp-triple-text">
        <h3 className="lp-triple-title">Run it in the same workspace.</h3>{" "}
        <p className="lp-triple-desc">
          Your team and agents share a terminal and filesystem. Run tests, start
          your app, and see the results together. Each teammate and agent can
          use their own Git worktree without overwriting someone else’s code.
        </p>
      </div>
      <div className="lp-feature-preview lp-terminal-preview">
        <div className="lp-feature-dots" aria-hidden="true" />
        <div className="lp-terminal-files" aria-hidden="true">
          <span>▧ app.ts</span>
          <span>▧ package.json</span>
          <span>▧ README.md</span>
        </div>
        <div className="lp-triple-stage lp-stage-terminal">
          <div className="lp-terminal-bar">
            <Terminal size={12} /> workspace · terminal
          </div>
          <div className="lp-terminal-output">
            <span>$ pnpm test</span>
            <span className="lp-terminal-test">✓ auth/session.test.ts</span>
            <span className="lp-terminal-test">✓ api/checkout.test.ts</span>
            <span className="lp-terminal-test">Tests: 14 passed</span>
            <span>$ pnpm dev</span>
            <span className="lp-terminal-start">Ready on localhost:3000</span>
            <span className="lp-terminal-prompt">
              $ <i />
            </span>
          </div>
        </div>
        <div className="lp-terminal-browser" aria-hidden="true">
          <div className="lp-terminal-bar">
            ● ● ● <span>localhost:3000</span>
          </div>
          <div className="lp-browser-content">
            <span>It’s alive.</span>
            <small>Your app, running in your workspace.</small>
            <i />
            <i />
            <i />
          </div>
        </div>
      </div>
    </div>
  );
}
