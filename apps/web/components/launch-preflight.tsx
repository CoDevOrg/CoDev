"use client";

import { useState } from "react";

interface Preflight {
  status: "ready" | "attention";
  release: string;
  checks: Record<string, "pass" | "fail" | "attention">;
  github: { installationCount: number };
  runtime: {
    hostState: string;
    activeWorkspaces: number;
    scaleToZero: "safe" | "in-use" | "attention";
  };
  recovery: string | null;
}

export function LaunchPreflight() {
  const [result, setResult] = useState<Preflight | null>(null);
  const [message, setMessage] = useState("");
  const [checking, setChecking] = useState(false);

  async function run() {
    setChecking(true);
    setMessage("");
    const response = await fetch("/api/launch/preflight", {
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as
      | (Preflight & { error?: string })
      | null;
    if (!response.ok || !payload) {
      setMessage(payload?.error ?? "Launch preflight could not be completed.");
      setChecking(false);
      return;
    }
    setResult(payload);
    setChecking(false);
  }

  return (
    <div className="launch-preflight">
      <button
        className="secondary-button"
        type="button"
        disabled={checking}
        onClick={() => void run()}
      >
        {checking ? "Checking…" : "Run launch preflight"}
      </button>
      {result ? (
        <>
          <div className="preflight-grid">
            {Object.entries(result.checks).map(([name, status]) => (
              <div key={name}>
                <span>{name}</span>
                <strong className={`preflight-${status}`}>{status}</strong>
              </div>
            ))}
          </div>
          <p className="security-note">
            Release {result.release.slice(0, 8)} · GitHub installations{" "}
            {result.github.installationCount} · AWS host{" "}
            {result.runtime.hostState} · Active workspaces{" "}
            {result.runtime.activeWorkspaces}
          </p>
          {result.recovery ? (
            <p className="form-message error-copy">{result.recovery}</p>
          ) : null}
        </>
      ) : null}
      {message ? <p className="form-message error-copy">{message}</p> : null}
    </div>
  );
}
