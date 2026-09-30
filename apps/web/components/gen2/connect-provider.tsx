"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { CodexHostedConnect } from "@/components/settings/codex-hosted-connect";

export type Gen2AgentChoice = "codex" | "claude";

export type Gen2ProviderStatus = {
  connected: boolean;
  via: "subscription" | "api-key" | null;
};

/**
 * Codex runs on the member's own credential, so a workspace is useless to
 * someone who has not connected one. Rather than let every turn fail with a
 * "connect Codex in Settings" error, ask for it here, in the place the work
 * is about to happen.
 */
export function Gen2ConnectProvider({
  onConnected,
  agent = "codex",
}: {
  onConnected: () => void;
  agent?: Gen2AgentChoice;
}) {
  if (agent === "claude") {
    return (
      <div className="gen2-connect">
        <h3>Connect Claude to run it here</h3>
        <p>
          Turns run on your own Claude subscription — CoDev does not supply one.
          Everyone in this workspace connects their own.
        </p>
        <p className="gen2-connect-alt">
          <Link href="/settings/personal/providers#coding-workspaces">
            Connect Claude in settings
          </Link>
          , then come back and refresh.
        </p>
        <button type="button" onClick={onConnected}>
          I've connected it
        </button>
      </div>
    );
  }
  return (
    <div className="gen2-connect">
      <h3>Connect ChatGPT to run Codex</h3>
      <p>
        Turns run on your own ChatGPT subscription or OpenAI key — CoDev does
        not supply one. Everyone in this workspace connects their own.
      </p>
      <CodexHostedConnect connected={false} onConnected={onConnected} />
      <p className="gen2-connect-alt">
        Prefer an API key?{" "}
        <Link href="/settings/personal/providers#coding-workspaces">
          Add one in settings
        </Link>
        .
      </p>
    </div>
  );
}

/** Polls only while disconnected, so a connected workspace costs nothing. */
export function useGen2ProviderStatus(agent: Gen2AgentChoice = "codex") {
  const [status, setStatus] = useState<Gen2ProviderStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/gen2/providers?provider=${agent}`);
      if (!response.ok) return;
      setStatus((await response.json()) as Gen2ProviderStatus);
    } catch {
      /* Leave the last known state; the composer still explains itself. */
    }
  }, [agent]);

  useEffect(() => {
    // Fetch-on-mount. apps/web has no data-fetching library, so an effect
    // is where a client component loads from its own API; these updates
    // land in an async continuation, which the rule cannot see.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return { status, refresh };
}
