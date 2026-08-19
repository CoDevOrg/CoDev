"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { Check, ChevronDown, Copy, KeyRound, UserCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OrcaCard } from "@/components/settings/orca-style";
import type {
  CliSubscriptionRecord,
  ProviderConnectionProvider,
  ProviderConnectionRecord,
} from "@/lib/provider-connection-view";
import { cn } from "@/lib/utils";

function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs">
      <span>
        <span className="text-emerald-400">$</span> {command}
      </span>
      <button
        aria-label="Copy command"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => {
          void navigator.clipboard.writeText(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        type="button"
      >
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
    </div>
  );
}

function AccordionRow({
  icon: Icon,
  title,
  description,
  connected,
  defaultOpen = false,
  children,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  description: string;
  connected: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      className="group border-t border-border/60 first:border-t-0"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 py-4 [&::-webkit-details-marker]:hidden">
        <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={cn(
              "size-1.5 rounded-full",
              connected ? "bg-emerald-400" : "bg-muted-foreground/50",
            )}
          />
          {connected ? "Connected" : "Not connected"}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-4 pb-5">{children}</div>
    </details>
  );
}

export function ProviderAccountCard({
  logo,
  label,
  cliSubscription,
  connection,
}: {
  logo: ReactNode;
  label: string;
  cliSubscription: CliSubscriptionRecord;
  connection: ProviderConnectionRecord;
}) {
  const [apiKeyState, setApiKeyState] = useState(connection);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"save" | "revoke" | "">("");
  const [message, setMessage] = useState("");
  const provider: ProviderConnectionProvider = connection.provider;
  const apiKeyLabel =
    provider === "openai" ? "OpenAI API Key" : "Anthropic API Key";

  async function save() {
    const apiKey = draft.trim();
    setBusy("save");
    setMessage("");
    try {
      const response = await fetch("/api/personal/connections", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, apiKey }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(payload?.error ?? "The key could not be saved.");
        return;
      }
      const next = (payload.connections as ProviderConnectionRecord[]).find(
        (row) => row.provider === provider,
      );
      if (next) setApiKeyState(next);
      setDraft("");
      setMessage(`${label} API key saved.`);
    } finally {
      setBusy("");
    }
  }

  async function revoke() {
    setBusy("revoke");
    setMessage("");
    try {
      const response = await fetch(
        `/api/personal/connections?provider=${provider}`,
        { method: "DELETE" },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(payload?.error ?? "The connection could not be revoked.");
        return;
      }
      const next = (payload.connections as ProviderConnectionRecord[]).find(
        (row) => row.provider === provider,
      );
      if (next) setApiKeyState(next);
      setDraft("");
      setMessage(`${label} connection revoked.`);
    } finally {
      setBusy("");
    }
  }

  const cliConnected = cliSubscription.status === "connected";
  const disabled = busy !== "";

  return (
    <OrcaCard className="px-6 py-5">
      <div className="mb-1 flex items-center gap-2.5">
        <span className="flex size-7 items-center justify-center text-foreground">
          {logo}
        </span>
        <h3 className="text-lg font-semibold">{label}</h3>
      </div>

      <AccordionRow
        connected={cliConnected}
        defaultOpen={!cliConnected}
        description={`Authenticate with your ${label} account.`}
        icon={UserCircle}
        title={label}
      >
        <p className="text-xs text-muted-foreground">
          1. Install the CoDev CLI
        </p>
        <CopyableCommand command="npm install -g @trycodev/cli" />
        <p className="text-xs text-muted-foreground">2. Log in to CoDev</p>
        <CopyableCommand command="codev login" />
        <p className="text-xs text-muted-foreground">3. Authenticate {label}</p>
        <CopyableCommand command={cliSubscription.command} />
      </AccordionRow>

      <AccordionRow
        connected={apiKeyState.status === "connected"}
        description={`Use an ${provider === "openai" ? "OpenAI" : "Anthropic"} API key for ${label}.`}
        icon={KeyRound}
        title={apiKeyLabel}
      >
        {apiKeyState.status === "connected" ? (
          <p className="text-xs text-muted-foreground">
            Connected · API key · supplied by {apiKeyState.suppliedBy} · ending{" "}
            {apiKeyState.lastFour}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`api-key-${provider}`}>
            {apiKeyLabel}
          </label>
          <Input
            autoComplete="off"
            className="min-w-[12rem] flex-1"
            disabled={disabled}
            id={`api-key-${provider}`}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Paste API key"
            spellCheck={false}
            type="password"
            value={draft}
          />
          <Button
            disabled={disabled}
            onClick={() => void save()}
            size="sm"
            type="button"
          >
            {busy === "save"
              ? "Saving…"
              : apiKeyState.status === "connected"
                ? "Replace key"
                : "Save key"}
          </Button>
          {apiKeyState.status === "connected" ? (
            <Button
              disabled={disabled}
              onClick={() => void revoke()}
              size="sm"
              type="button"
              variant="outline"
            >
              {busy === "revoke" ? "Revoking…" : "Revoke"}
            </Button>
          ) : null}
        </div>
      </AccordionRow>

      {message ? (
        <p className="pt-3 text-xs text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
    </OrcaCard>
  );
}
