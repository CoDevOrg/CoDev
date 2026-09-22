"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CircleAlert,
  LoaderCircle,
  RotateCw,
  X,
} from "lucide-react";
import type {
  Gen2ProviderReadiness,
  Gen2WorkspaceCapabilities,
} from "@codev/contracts";

import {
  ClaudeMark,
  CursorMark,
  OpenAIMark,
} from "@/components/settings/provider-logos";
type ProviderResponse = { providers?: Gen2ProviderReadiness[]; error?: string };

const PROVIDER_BRANDS = {
  openai: { label: "OpenAI", icon: OpenAIMark },
  anthropic: { label: "Anthropic", icon: ClaudeMark },
  cursor: { label: "Cursor", icon: CursorMark },
} as const;

function providerState(provider: Gen2ProviderReadiness) {
  if (!provider.installed) return "Not yet supported";
  if (provider.ready) return "Connected";
  return "Available";
}

function providerDescription(provider: Gen2ProviderReadiness) {
  if (!provider.installed) {
    return "Gen 2 cannot run agents with this provider yet.";
  }
  if (provider.ready) {
    return "Your connection is ready for agent turns in this workspace.";
  }
  return "Connect your account to run agents with this provider.";
}

export function Gen2ProviderSettingsPanel({
  canManageOwnConnection,
  onClose,
}: {
  canManageOwnConnection: Gen2WorkspaceCapabilities["connection.manageOwn"];
  onClose: () => void;
}) {
  const [providers, setProviders] = useState<Gen2ProviderReadiness[] | null>(
    null,
  );
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    fetch("/api/gen2/providers")
      .then(async (response) => {
        const payload = (await response
          .json()
          .catch(() => ({}))) as ProviderResponse;
        if (!response.ok || !payload.providers) {
          throw new Error(payload.error ?? "Could not load provider status.");
        }
        if (active) {
          setProviders(payload.providers);
          setError("");
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load provider status.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [reload]);

  return (
    <section
      aria-labelledby="gen2-provider-settings-title"
      className="gen2-provider-settings"
      id="gen2-provider-settings-panel"
    >
      <div className="gen2-access-header">
        <div>
          <h2 id="gen2-provider-settings-title">Providers</h2>
          <p>
            See which providers can run your agent turns. Credentials are never
            shown here.
          </p>
        </div>
        <button
          aria-label="Close provider settings"
          className="gen2-access-close"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={17} />
        </button>
      </div>

      {error ? (
        <div className="gen2-provider-error" role="alert">
          <CircleAlert aria-hidden="true" size={16} />
          <span>{error}</span>
          <button
            className="gen2-provider-retry"
            onClick={() => setReload((value) => value + 1)}
            type="button"
          >
            <RotateCw aria-hidden="true" size={14} /> Try again
          </button>
        </div>
      ) : null}

      {providers === null && !error ? (
        <p className="gen2-provider-loading" role="status" aria-busy="true">
          <LoaderCircle aria-hidden="true" size={16} /> Loading provider status…
        </p>
      ) : null}

      {providers ? (
        <ul className="gen2-provider-list" aria-label="Gen 2 providers">
          {providers.map((provider) => {
            const brand = PROVIDER_BRANDS[provider.id];
            const Icon = brand.icon;
            const state = providerState(provider);
            return (
              <li className="gen2-provider-row" key={provider.id}>
                <span className="gen2-provider-mark">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <div className="gen2-provider-copy">
                  <strong>{brand.label}</strong>
                  <span>{providerDescription(provider)}</span>
                </div>
                <span
                  className={`gen2-provider-state ${
                    provider.installed
                      ? provider.ready
                        ? "gen2-provider-state-connected"
                        : "gen2-provider-state-available"
                      : "gen2-provider-state-unsupported"
                  }`}
                >
                  {state}
                </span>
                {provider.installed && canManageOwnConnection ? (
                  <Link
                    className="gen2-provider-manage"
                    href="/settings/personal/providers#coding-workspaces"
                  >
                    Manage connection
                    <ArrowUpRight aria-hidden="true" size={14} />
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {!canManageOwnConnection ? (
        <p className="gen2-provider-readonly" role="note">
          Your workspace role allows viewing provider availability but not
          managing connections.
        </p>
      ) : null}
    </section>
  );
}
