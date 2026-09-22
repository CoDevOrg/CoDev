"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Gen2ProviderReadiness } from "@codev/contracts";

import { CodexHostedConnect } from "@/components/settings/codex-hosted-connect";

export type Gen2ProviderStatus = {
  connected: boolean;
  via: "subscription" | "api-key" | null;
};

type Gen2ProviderResponse = Gen2ProviderStatus & {
  providers?: Gen2ProviderReadiness[];
};

/**
 * Codex runs on the member's own credential, so a workspace is useless to
 * someone who has not connected one. Rather than let every turn fail with a
 * "connect Codex in Settings" error, ask for it here, in the place the work
 * is about to happen.
 */
export function Gen2ConnectProvider({
  onConnected,
}: {
  onConnected: () => void;
}) {
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
export function useGen2ProviderStatus() {
  const [status, setStatus] = useState<Gen2ProviderStatus | null>(null);
  const [providers, setProviders] = useState<Gen2ProviderReadiness[] | null>(
    null,
  );

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/gen2/providers");
      if (!response.ok) return;
      const payload = (await response.json()) as Gen2ProviderResponse;
      setStatus({ connected: payload.connected, via: payload.via });
      setProviders(payload.providers ?? null);
    } catch {
      /* Leave the last known state; the composer still explains itself. */
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount. apps/web has no data-fetching library, so an effect
    // is where a client component loads from its own API; these updates
    // land in an async continuation, which the rule cannot see.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return { status, providers, refresh };
}
