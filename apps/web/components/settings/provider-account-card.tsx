"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { Check, ChevronDown, Copy, KeyRound, Terminal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClaudeHostedConnect } from "@/components/settings/claude-hosted-connect";
import { CodexHostedConnect } from "@/components/settings/codex-hosted-connect";
import { OrcaCard } from "@/components/settings/orca-style";
import type {
  ClaudeCliTokenRecord,
  CliSubscriptionRecord,
  ProviderConnectionProvider,
  ProviderConnectionRecord,
} from "@/lib/provider-connection-view";
import type {
  ProviderSurface,
  ProviderSurfaceCapability,
} from "@/lib/provider-surface-capability";
import { cn } from "@/lib/utils";

const RETURN_TO = "/settings/personal/providers";

/**
 * The in-page sign-in state for a provider with a browser OAuth flow. Only
 * Cursor still has one — Claude and Codex connect via an API key or the
 * CoDev CLI (which itself delegates to each provider's own official CLI
 * login), since Anthropic and OpenAI both restrict consumer-plan OAuth
 * tokens obtained outside their own first-party clients.
 */
type ActiveFlow = { kind: "polling"; loginUrl: string };

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
  surface,
  capability,
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
   * Which settings section this card sits in. `rooms` offers browser and CLI
   * sign-ins; `workspace` offers an API key and CLI sign-in only, since a
   * browser sign-in never reaches the shared host. Omitted renders the
   * combined card with every method.
   */
  surface?: ProviderSurface;
  /** Per-surface readiness, for the header line and the toggles. */
  capability?: ProviderSurfaceCapability;
  /** Claude's `codev claude-auth` setup-token — its workspace login. */
  claudeCliToken?: ClaudeCliTokenRecord;
}) {
  const router = useRouter();
  const [apiKeyState, setApiKeyState] = useState(connection);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<
    "connect" | "disconnect" | "save" | "revoke" | ""
  >("");
  const [message, setMessage] = useState("");
  const [flow, setFlow] = useState<ActiveFlow | null>(null);
  const [connected, setConnected] = useState(
    subscription.status === "connected",
  );
  const provider: ProviderConnectionProvider = connection.provider;
  const apiKeyLabel = `${connection.label} API key`;
  const disabled = busy !== "";

  // Cursor is the only provider left with a browser sign-in: the tab does
  // the signing in and CoDev learns about it only by polling its own
  // callback. Claude and Codex connect through the rows below instead.
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartedAt = useRef(0);
  const isCursor = subscription.provider === "cursor";
  const roomsSurface = surface === "rooms";
  const workspaceSurface = surface === "workspace";
  // A browser sign-in (hosted Claude/Codex connect, Cursor's deeplink) never
  // powers a coding workspace, so the workspace section does not offer one.
  const offerBrowserConnect = !workspaceSurface;
  // The rooms executor cannot run an API key yet, so the rooms section does
  // not offer one; see ROOMS_ACCEPT_API_KEY in provider-surface-capability.
  const offerApiKey = !roomsSurface;
  const showClaudeConnect =
    offerBrowserConnect &&
    hostedClaudeConnect &&
    subscription.provider === "claude";
  const showCodexConnect =
    offerBrowserConnect &&
    hostedOpenAIConnect &&
    subscription.provider === "codex";
  const showHostedConnect = showClaudeConnect || showCodexConnect;
  const cliTokenConnected = claudeCliToken?.status === "connected";
  // In the workspace section "signed in" means a login the shared host can
  // use: Codex's CLI login, or Claude's CLI setup-token. Cursor has neither.
  const workspaceLoginConnected = workspaceSurface
    ? subscription.provider === "claude"
      ? cliTokenConnected
      : subscription.provider === "codex"
        ? connected && subscription.provenance === "cli"
        : false
    : connected;
  const surfaceReady = capability
    ? workspaceSurface
      ? capability.workspace.ready
      : capability.rooms.ready
    : undefined;
  useEffect(
    () => () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    },
    [],
  );

  function stopPolling() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  function finishConnected() {
    stopPolling();
    setFlow(null);
    setBusy("");
    setConnected(true);
    setMessage(`${label} is connected.`);
    router.refresh();
  }

  async function poll() {
    const response = await fetch("/api/auth/oauth/cursor/poll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      status?: string;
      error?: string;
    };
    if (!response.ok) {
      stopPolling();
      setFlow(null);
      setBusy("");
      setMessage(payload.error ?? `${label} sign-in failed. Start again.`);
      return;
    }
    if (payload.status === "connected") {
      finishConnected();
      return;
    }
    if (payload.status === "denied") {
      stopPolling();
      setFlow(null);
      setBusy("");
      setMessage(`${label} sign-in was cancelled.`);
      return;
    }
    // Still pending. Cursor's browser sign-in can quietly fail to hand a token
    // back to a non-CLI poller; nudge toward the API key rather than spinning
    // forever with no signal.
    if (
      isCursor &&
      pollStartedAt.current > 0 &&
      Date.now() - pollStartedAt.current > 90_000
    ) {
      setMessage(
        "Still waiting on Cursor. If you already finished signing in, connect with an API key below instead.",
      );
    }
  }

  async function connect() {
    setBusy("connect");
    setMessage("");
    setFlow(null);
    stopPolling();

    const response = await fetch("/api/auth/oauth/cursor/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scopeType: "USER", returnTo: RETURN_TO }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      mode?: string;
      loginUrl?: string;
      error?: string;
    };
    if (!response.ok) {
      setBusy("");
      setMessage(payload.error ?? `${label} sign-in could not start.`);
      return;
    }

    if (payload.mode === "cursor_deeplink" && payload.loginUrl) {
      window.open(payload.loginUrl, "_blank", "noopener,noreferrer");
      setFlow({ kind: "polling", loginUrl: payload.loginUrl });
      pollStartedAt.current = Date.now();
      void poll();
      pollTimer.current = setInterval(() => void poll(), 2000);
      return;
    }

    setBusy("");
    setMessage(`${label} returned an unexpected sign-in response.`);
  }

  function cancelFlow() {
    stopPolling();
    setFlow(null);
    setBusy("");
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
      // Cursor: exchange the user API key for the same token pair the browser
      // login yields, so it lands as one `cursor` connection either way and
      // `cursor-agent` gets a real refreshable session, not a bare key.
      if (isCursor) {
        const response = await fetch("/api/auth/oauth/cursor/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ apiKey: draft.trim(), scopeType: "USER" }),
        });
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (!response.ok) {
          setMessage(payload?.error ?? "The Cursor API key was not accepted.");
          return;
        }
        setDraft("");
        finishConnected();
        return;
      }

      const response = await fetch("/api/personal/connections", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        // A key pasted in a section is enabled for that section only.
        body: JSON.stringify({
          provider,
          apiKey: draft.trim(),
          ...(surface ? { surface } : {}),
        }),
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

  /** Flip a credential's "also use in <other surface>" toggle. */
  async function setSurface(
    kind: "api_key" | "subscription" | "claude_cli_token",
    target: ProviderSurface,
    enabled: boolean,
  ) {
    setBusy("save");
    setMessage("");
    try {
      const response = await fetch("/api/personal/connections", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, kind, surface: target, enabled }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(payload?.error ?? "The setting could not be saved.");
        return;
      }
      setMessage(
        enabled
          ? `${label} will also be used in ${target === "rooms" ? "chat rooms" : "coding workspaces"}.`
          : `${label} is no longer used in ${target === "rooms" ? "chat rooms" : "coding workspaces"}.`,
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

  const headerStatus = workspaceSurface
    ? surfaceReady
      ? "Ready for coding workspaces"
      : "Connect with an API key or from your terminal below"
    : roomsSurface
      ? surfaceReady
        ? "Ready for chat rooms"
        : isCursor || showHostedConnect
          ? "Sign in with your subscription — no API key needed"
          : "Connect from your terminal below"
      : connected
        ? "Signed in with your subscription"
        : isCursor || showHostedConnect
          ? "Sign in with your subscription — no API key needed"
          : "Connect with an API key or the CoDev CLI below";

  return (
    <OrcaCard className="px-4 py-3.5">
      <div className="flex items-center gap-2.5">
        <span className="flex size-6 items-center justify-center text-foreground">
          {logo}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{label}</h3>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <StatusDot connected={surfaceReady ?? workspaceLoginConnected} />
            {headerStatus}
          </p>
        </div>
        {workspaceSurface ? (
          subscription.provider === "claude" && cliTokenConnected ? (
            <Button
              disabled={disabled}
              onClick={() => void revokeClaudeCliToken()}
              size="sm"
              type="button"
              variant="outline"
            >
              {busy === "revoke" ? "Revoking…" : "Revoke CLI login"}
            </Button>
          ) : subscription.provider === "codex" && workspaceLoginConnected ? (
            <Button
              disabled={disabled}
              onClick={() => void disconnect()}
              size="sm"
              type="button"
              variant="outline"
            >
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </Button>
          ) : null
        ) : isCursor && offerBrowserConnect ? (
          connected ? (
            <div className="flex shrink-0 gap-2">
              <Button
                disabled={disabled}
                onClick={() => void connect()}
                size="sm"
                type="button"
                variant="outline"
              >
                Reconnect
              </Button>
              <Button
                disabled={disabled}
                onClick={() => void disconnect()}
                size="sm"
                type="button"
                variant="outline"
              >
                {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
              </Button>
            </div>
          ) : (
            <Button
              className="shrink-0"
              disabled={disabled}
              onClick={() => void connect()}
              size="sm"
              type="button"
            >
              {busy === "connect" && !flow ? "Starting…" : `Connect ${label}`}
            </Button>
          )
        ) : connected ? (
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

      {flow?.kind === "polling" ? (
        <div className="mt-3 flex items-center gap-2.5 rounded-md border border-border bg-background/60 p-3">
          <p className="flex-1 text-xs text-muted-foreground">
            Finish signing in on the {label} tab (
            <a
              className="underline"
              href={flow.loginUrl}
              rel="noreferrer"
              target="_blank"
            >
              reopen
            </a>
            ). Keep this page open…
          </p>
          <Button
            onClick={cancelFlow}
            size="sm"
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
        </div>
      ) : null}

      <div className="mt-3">
        {!offerApiKey ? (
          <p className="border-t border-border/60 py-2.5 text-[11px] text-muted-foreground">
            API key support for chat rooms is coming soon. For now, sign in with
            your subscription above or from your terminal.
          </p>
        ) : null}
        {offerApiKey ? (
          <FallbackRow
            connected={apiKeyState.status === "connected"}
            defaultOpen={
              workspaceSurface
                ? !workspaceLoginConnected && apiKeyState.status !== "connected"
                : !connected && !showHostedConnect
            }
            description={
              isCursor
                ? "From cursor.com → Dashboard → API Keys. More reliable than the browser sign-in — CoDev exchanges it for a real session."
                : `Bill usage to your own ${connection.label} account instead of a subscription.`
            }
            icon={KeyRound}
            title={
              isCursor
                ? "Connect with a Cursor API key"
                : "Use an API key instead"
            }
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
                placeholder={isCursor ? "key_…" : "Paste API key"}
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
                  ? isCursor
                    ? "Connecting…"
                    : "Saving…"
                  : isCursor
                    ? connected
                      ? "Replace"
                      : "Connect"
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
              workspaceSurface
                ? workspaceLoginConnected
                : connected && subscription.provenance === "cli"
            }
            defaultOpen={
              workspaceSurface
                ? !workspaceLoginConnected && apiKeyState.status !== "connected"
                : !connected && !showHostedConnect
            }
            description={
              workspaceSurface
                ? "Sign in from your own terminal. This login can also power chat rooms."
                : "Run the same sign-in from the CoDev CLI. A terminal login can also power coding workspaces."
            }
            icon={Terminal}
            title="Connect from a terminal"
          >
            {workspaceSurface &&
            subscription.provider === "claude" &&
            cliTokenConnected ? (
              <p className="text-xs text-muted-foreground">
                Connected via codev claude-auth
                {claudeCliToken?.lastFour
                  ? ` · ending ${claudeCliToken.lastFour}`
                  : ""}
              </p>
            ) : null}
            <CopyableCommand command="npm install -g @trycodev/cli" />
            <CopyableCommand command="codev login" />
            <CopyableCommand command={subscription.command} />
          </FallbackRow>
        ) : null}

        {roomsSurface && connected && subscription.provenance ? (
          subscription.provenance === "cli" &&
          subscription.provider !== "claude" ? (
            <SurfaceToggle
              checked={subscription.enabledForWorkspace ?? true}
              disabled={disabled}
              label="Also use in coding workspaces"
              note="Your terminal login can run on the workspace host."
              onChange={(next) =>
                void setSurface("subscription", "workspace", next)
              }
            />
          ) : (
            <p className="border-t border-border/60 py-2.5 text-[11px] text-muted-foreground">
              Browser sign-ins stay in chat rooms. To use {label} in coding
              workspaces, add an API key or sign in from your terminal there.
            </p>
          )
        ) : null}

        {workspaceSurface &&
        subscription.provider === "codex" &&
        workspaceLoginConnected ? (
          <SurfaceToggle
            checked={subscription.enabledForRooms ?? true}
            disabled={disabled}
            label="Also use in chat rooms"
            note="Your terminal login can answer in chat rooms too."
            onChange={(next) => void setSurface("subscription", "rooms", next)}
          />
        ) : null}

        {workspaceSurface &&
        subscription.provider === "codex" &&
        connected &&
        subscription.provenance === "browser" ? (
          <p className="border-t border-border/60 py-2.5 text-[11px] text-muted-foreground">
            {label} is signed in for chat rooms through the browser, which
            cannot reach the workspace host. Add an API key or run{" "}
            {subscription.command} to use it here.
          </p>
        ) : null}

        {workspaceSurface && apiKeyState.status === "connected" ? (
          <p className="border-t border-border/60 py-2.5 text-[11px] text-muted-foreground">
            API keys stay in coding workspaces; chat rooms run on a
            subscription.
          </p>
        ) : null}
      </div>

      {message ? (
        <p className="pt-2.5 text-[11px] text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
    </OrcaCard>
  );
}
