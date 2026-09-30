"use client";

import { useRouter } from "next/navigation";
import { useState, type ComponentType, type ReactNode } from "react";
import { Check, ChevronDown, Copy, KeyRound, Terminal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ClaudeHostedConnect } from "@/components/settings/claude-hosted-connect";
import { CodexHostedConnect } from "@/components/settings/codex-hosted-connect";
import type {
  ClaudeCliTokenRecord,
  CliSubscriptionRecord,
  ProviderConnectionProvider,
  ProviderConnectionRecord,
} from "@/lib/providers/provider-connection-view";
import { SURFACE_LABEL } from "@/lib/providers/provider-surface-capability";
import type { ExecutorSurface } from "@/lib/providers/registry";
import { cn } from "@/lib/platform/utils";

function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-[11px]">
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
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </button>
    </div>
  );
}

/**
 * "Also use in <the other surface>". Rendered only where the method actually
 * allows the flip; an impossible case (a browser sign-in into a workspace) is
 * explained in plain text instead of a dead switch.
 */
function SurfaceToggle({
  label,
  note,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  note?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-t border-border/60 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">{label}</p>
        {note ? (
          <p className="text-[11px] text-muted-foreground">{note}</p>
        ) : null}
      </div>
      <button
        aria-checked={checked}
        aria-label={label}
        className={cn(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-emerald-500" : "bg-muted-foreground/30",
          disabled && "cursor-not-allowed opacity-50",
        )}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        role="switch"
        type="button"
      >
        <span
          className={cn(
            "absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform",
            checked ? "left-4" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span
      className={cn(
        "size-1.5 rounded-full",
        connected ? "bg-emerald-400" : "bg-muted-foreground/50",
      )}
    />
  );
}

/**
 * Where this provider runs, named the way the sidebar names it.
 *
 * The status is carried by the words, not by the dot: a member who cannot
 * distinguish the colours still reads "Runs in Rooms and Gen 2". The dot is
 * a second, redundant cue rather than the only one.
 *
 * "Connected, but runs nowhere" is its own state and says so. That case is
 * real — a Claude setup-token with no browser login runs in Workspaces but
 * not Rooms — and collapsing it into "Not connected" is what used to send
 * members off to reconnect something they already had.
 */
function RunsIn({
  surfaces,
  connected,
}: {
  surfaces: ExecutorSurface[];
  connected: boolean;
}) {
  if (surfaces.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <StatusDot connected={false} />
        {connected
          ? "Connected, but nothing here can run it yet"
          : "Not connected"}
      </p>
    );
  }
  const names = surfaces.map((surface) => SURFACE_LABEL[surface]);
  const spoken =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
      <StatusDot connected />
      <span className="sr-only">{`Runs in ${spoken}`}</span>
      <span aria-hidden>Runs in</span>
      {surfaces.map((surface) => (
        <span
          aria-hidden
          className="rounded-full border border-border/70 px-1.5 py-px text-[10px] font-medium text-foreground/80"
          key={surface}
        >
          {SURFACE_LABEL[surface]}
        </span>
      ))}
    </p>
  );
}

function FallbackRow({
  icon: Icon,
  title,
  description,
  connected,
  defaultOpen,
  children,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  description: string;
  connected?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="group border-t border-border/60" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center gap-2.5 py-2.5 [&::-webkit-details-marker]:hidden">
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">{title}</p>
          <p className="text-[11px] text-muted-foreground">{description}</p>
        </div>
        {connected ? (
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <StatusDot connected />
            Connected
          </span>
        ) : null}
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-2.5 pb-3">{children}</div>
    </details>
  );
}

export function ProviderAccountCard({
  logo,
  label,
  subscription,
  connection,
  hostedClaudeConnect = false,
  hostedOpenAIConnect = false,
  runsIn,
  claudeCliToken,
}: {
  logo: ReactNode;
  label: string;
  subscription: CliSubscriptionRecord;
  connection: ProviderConnectionRecord;
  /** Show the in-app "Connect Claude" flow (anthropic card only). */
  hostedClaudeConnect?: boolean;
  /** Show the in-app "Connect ChatGPT" device-code flow (openai card only). */
  hostedOpenAIConnect?: boolean;
  /**
   * Where this provider can run right now, derived from the registry by
   * `providerRunsIn`. The card states it rather than deducing it: the two
   * settings sections this replaced each described a surface in prose, and
   * keeping that prose true by hand is what produced a green "Ready for chat
   * rooms" for a login rooms cannot run.
   */
  runsIn: ExecutorSurface[];
  /** Claude's `codev claude-auth` setup-token. */
  claudeCliToken?: ClaudeCliTokenRecord;
}) {
  const router = useRouter();
  const [apiKeyState, setApiKeyState] = useState(connection);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<
    "disconnect" | "save" | "revoke" | ""
  >("");
  const [message, setMessage] = useState("");
  const [connected, setConnected] = useState(
    subscription.status === "connected",
  );
  const provider: ProviderConnectionProvider = connection.provider;
  const apiKeyLabel = `${connection.label} API key`;
  const disabled = busy !== "";

  const showClaudeConnect =
    hostedClaudeConnect && subscription.provider === "claude";
  const showCodexConnect =
    hostedOpenAIConnect && subscription.provider === "codex";
  const showHostedConnect = showClaudeConnect || showCodexConnect;
  const cliTokenConnected = claudeCliToken?.status === "connected";
  // The sharing choice only exists for a login a workspace can actually run.
  const runsInSharedWorkspace = runsIn.includes("gen2");
  const anythingConnected =
    connected || cliTokenConnected || apiKeyState.status === "connected";
  function finishConnected() {
    setBusy("");
    setConnected(true);
    setMessage(`${label} is connected.`);
    router.refresh();
  }

  async function disconnect() {
    setBusy("disconnect");
    setMessage("");
    try {
      const response = await fetch(
        `/api/personal/subscriptions?provider=${subscription.provider}`,
        { method: "DELETE" },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(payload?.error ?? "The account could not be disconnected.");
        return;
      }
      setConnected(false);
      setMessage(`${label} disconnected.`);
      router.refresh();
    } finally {
      setBusy("");
    }
  }

  async function save() {
    setBusy("save");
    setMessage("");
    try {
      const response = await fetch("/api/personal/connections", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, apiKey: draft.trim() }),
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
      setMessage(`${apiKeyLabel} saved.`);
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
        setMessage(payload?.error ?? "The key could not be revoked.");
        return;
      }
      const next = (payload.connections as ProviderConnectionRecord[]).find(
        (row) => row.provider === provider,
      );
      if (next) setApiKeyState(next);
      setDraft("");
      setMessage(`${apiKeyLabel} revoked.`);
    } finally {
      setBusy("");
    }
  }

  /**
   * Flip whether this credential may fund a turn inside a shared workspace.
   *
   * It used to be a pair of "also use in <other surface>" switches. Those
   * wrote two columns that only one resolution path out of three ever read,
   * so flipping one changed a badge and nothing else; where a credential can
   * run is now the provider registry's answer. This is the part that was
   * genuinely the member's to decide: whose subscription gets spent when the
   * work lands somewhere other people can see.
   */
  async function setSharedWorkspaceUse(
    kind: "api_key" | "subscription" | "claude_cli_token",
    enabled: boolean,
  ) {
    setBusy("save");
    setMessage("");
    try {
      const response = await fetch("/api/personal/connections", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          kind,
          allowInSharedWorkspaces: enabled,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(payload?.error ?? "The setting could not be saved.");
        return;
      }
      setMessage(
        enabled
          ? `${label} can be used in shared workspaces.`
          : `${label} will stay out of shared workspaces.`,
      );
      router.refresh();
    } finally {
      setBusy("");
    }
  }

  async function revokeClaudeCliToken() {
    setBusy("revoke");
    setMessage("");
    try {
      const response = await fetch(
        "/api/personal/connections?provider=anthropic&kind=claude_cli_token",
        { method: "DELETE" },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(payload?.error ?? "The CLI login could not be revoked.");
        return;
      }
      setMessage(`${label} CLI login revoked.`);
      router.refresh();
    } finally {
      setBusy("");
    }
  }

  return (
    <Card className="px-4 py-3.5">
      <div className="flex items-center gap-2.5">
        <span className="flex size-6 items-center justify-center text-foreground">
          {logo}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{label}</h3>
          <RunsIn connected={anythingConnected} surfaces={runsIn} />
        </div>
        {connected ? (
          <Button
            disabled={disabled}
            onClick={() => void disconnect()}
            size="sm"
            type="button"
            variant="outline"
          >
            {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
          </Button>
        ) : null}
      </div>

      {showClaudeConnect ? (
        <ClaudeHostedConnect
          connected={connected}
          onConnected={finishConnected}
        />
      ) : null}

      {showCodexConnect ? (
        <CodexHostedConnect
          connected={connected}
          onConnected={finishConnected}
        />
      ) : null}

      <div className="mt-3">
        {true ? (
          <FallbackRow
            connected={apiKeyState.status === "connected"}
            // Open only when there is nothing else to use: the connect
            // buttons above are the shorter path for most members.
            defaultOpen={!anythingConnected && !showHostedConnect}
            description={`Bill usage to your own ${connection.label} account instead of a subscription.`}
            icon={KeyRound}
            title="Use an API key instead"
          >
            {apiKeyState.status === "connected" ? (
              <p className="text-xs text-muted-foreground">
                Saved by {apiKeyState.suppliedBy} · ending{" "}
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
                disabled={disabled || !draft.trim()}
                onClick={() => void save()}
                size="sm"
                type="button"
                variant="outline"
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
                  variant="secondary"
                >
                  {busy === "revoke" ? "Revoking…" : "Revoke"}
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Keys are encrypted on the CoDev server and never shown again after
              you save them.
            </p>
          </FallbackRow>
        ) : null}

        {subscription.command ? (
          <FallbackRow
            connected={
              cliTokenConnected ||
              (connected && subscription.provenance === "cli")
            }
            defaultOpen={!anythingConnected && !showHostedConnect}
            description="Sign in from your own terminal with the CoDev CLI."
            icon={Terminal}
            title="Connect from a terminal"
          >
            {subscription.provider === "claude" && cliTokenConnected ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Connected via codev claude-auth
                  {claudeCliToken?.lastFour
                    ? ` · ending ${claudeCliToken.lastFour}`
                    : ""}
                </p>
                <Button
                  disabled={disabled}
                  onClick={() => void revokeClaudeCliToken()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {busy === "revoke" ? "Revoking…" : "Revoke"}
                </Button>
              </div>
            ) : null}
            <CopyableCommand command="npm install -g @trycodev/cli" />
            <CopyableCommand command="codev login" />
            <CopyableCommand command={subscription.command} />
          </FallbackRow>
        ) : null}

        {runsInSharedWorkspace ? (
          <SurfaceToggle
            checked={subscription.allowInSharedWorkspaces}
            disabled={disabled}
            label="Allow in shared workspaces"
            note="Turns you start in a workspace other people can see run on this login, and are billed to you."
            onChange={(next) =>
              void setSharedWorkspaceUse("subscription", next)
            }
          />
        ) : null}
      </div>

      {message ? (
        <p className="pt-2.5 text-[11px] text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
    </Card>
  );
}
