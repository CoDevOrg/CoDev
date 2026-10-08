"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Gen2AgentProviderName } from "@codev/contracts";

import { CodexHostedConnect } from "@/components/settings/codex-hosted-connect";
import { WorkspaceButton } from "./workspace-button";

const SETTINGS_HREF = "/settings/personal/providers";

export type Gen2AgentChoice = Gen2AgentProviderName;

export type { Gen2ProviderStatus } from "@codev/contracts";
import type { Gen2ProviderStatus } from "@codev/contracts";

/**
 * Codex runs on the member's own credential, so a workspace is useless to
 * someone who has not connected one. Rather than let every turn fail with a
 * "connect Codex in Settings" error, ask for it here, in the place the work
 * is about to happen. With `onOpenSettings` the member connects without
 * leaving the workspace; without it, the prompt links to the settings page.
 */
export function Gen2ConnectProvider({
  onConnected,
  onOpenSettings,
  agent,
}: {
  onConnected: () => void;
  onOpenSettings?: (() => void) | undefined;
  agent: Gen2AgentChoice;
}) {
  if (agent === "claude" || agent === "cursor") {
    const name = agent === "claude" ? "Claude" : "Cursor";
    return (
      <div className="gen2-connect">
        <h3>Connect {name} to run it here</h3>
        <p>
          Turns run on your own {name} connection — CoDev does not supply one.
          Everyone in this workspace connects their own.
        </p>
        {onOpenSettings ? (
          <div className="gen2-connect-actions">
            <WorkspaceButton
              tone="primary"
              size="action"
              onClick={onOpenSettings}
            >
              Connect {name}
            </WorkspaceButton>
          </div>
        ) : (
          <div className="gen2-connect-actions">
            <Link
              href={SETTINGS_HREF}
              className="gen2-workspace-button"
              data-slot="button"
              data-tone="primary"
              data-size="action"
            >
              Connect {name} in settings
            </Link>
            <WorkspaceButton
              tone="secondary"
              size="action"
              onClick={onConnected}
            >
              I&rsquo;ve connected it
            </WorkspaceButton>
          </div>
        )}
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
      <div className="gen2-connect-actions">
        <CodexHostedConnect
          buttonClassName="min-h-10"
          buttonSize="default"
          buttonVariant="solid"
          connected={false}
          onConnected={onConnected}
        />
      </div>
      <p className="gen2-connect-alt">
        Prefer an API key?{" "}
        {onOpenSettings ? (
          <button
            type="button"
            className="gen2-connect-link"
            onClick={onOpenSettings}
          >
            Add one in settings
          </button>
        ) : (
          <Link href={SETTINGS_HREF}>Add one in settings</Link>
        )}
        .
      </p>
    </div>
  );
}

/** Polls only while disconnected, so a connected workspace costs nothing. */
export function useGen2ProviderStatus(agent: Gen2AgentChoice) {
  const [statuses, setStatuses] = useState<
    Partial<Record<Gen2AgentChoice, Gen2ProviderStatus>>
  >({});
  const status = statuses[agent] ?? null;

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/gen2/providers?provider=${agent}`);
      if (!response.ok) return;
      const value = (await response.json()) as Gen2ProviderStatus;
      setStatuses((current) => ({ ...current, [agent]: value }));
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
