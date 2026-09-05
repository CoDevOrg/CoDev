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
import { OrcaCard } from "@/components/settings/orca-style";
import type {
  CliSubscriptionRecord,
  ProviderConnectionProvider,
  ProviderConnectionRecord,
} from "@/lib/provider-connection-view";
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
      <summary className="flex cursor-pointer list-none items-center gap-3 py-3 [&::-webkit-details-marker]:hidden">
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        {connected ? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <StatusDot connected />
            Connected
          </span>
        ) : null}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-3 pb-4">{children}</div>
    </details>
  );
}

export function ProviderAccountCard({
  logo,
  label,
  subscription,
  connection,
}: {
  logo: ReactNode;
  label: string;
  subscription: CliSubscriptionRecord;
  connection: ProviderConnectionRecord;
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

  return (
    <OrcaCard className="px-6 py-5">
      <div className="flex items-center gap-3">
        <span className="flex size-7 items-center justify-center text-foreground">
          {logo}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold">{label}</h3>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <StatusDot connected={connected} />
            {connected
              ? "Signed in with your subscription"
              : isCursor
                ? "Sign in with your account — no API key needed"
                : "Connect with an API key or the CoDev CLI below"}
          </p>
        </div>
        {isCursor ? (
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

      {flow?.kind === "polling" ? (
        <div className="mt-4 flex items-center gap-3 rounded-md border border-border bg-background/60 p-4">
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

      <div className="mt-4">
        <FallbackRow
          connected={apiKeyState.status === "connected"}
          defaultOpen={!connected}
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
              Saved by {apiKeyState.suppliedBy} · ending {apiKeyState.lastFour}
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

        {subscription.command ? (
          <FallbackRow
            defaultOpen={!connected}
            description="Run the same sign-in from the CoDev CLI."
            icon={Terminal}
            title="Connect from a terminal"
          >
            <CopyableCommand command="npm install -g @trycodev/cli" />
            <CopyableCommand command="codev login" />
            <CopyableCommand command={subscription.command} />
          </FallbackRow>
        ) : null}
      </div>

      {message ? (
        <p className="pt-3 text-xs text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
    </OrcaCard>
  );
}
