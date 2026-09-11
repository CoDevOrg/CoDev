"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  ChevronRight,
  ChevronUp,
  LoaderCircle,
  Send,
  Sparkles,
} from "lucide-react";

import {
  importedConversationMessageSchema,
  type ImportedConversationMessage,
} from "@codev/contracts";

import styles from "./shared-chat-room.module.css";

type MessageResponse = {
  message?: ImportedConversationMessage;
  reply?: ImportedConversationMessage;
  error?: string;
};

const optionsSchema = z.object({
  options: z.array(
    z.object({
      provider: z.enum(["claude", "codex"]),
      models: z.array(z.string()),
    }),
  ),
});

const PROVIDER_META: Record<
  string,
  { label: string; logo: string; color: string }
> = {
  claude: { label: "Claude", logo: "A", color: "var(--codev-gold-500)" },
  codex: { label: "OpenAI Codex", logo: "O", color: "#0e8f6f" },
};

function providerMeta(provider: string) {
  return (
    PROVIDER_META[provider] ?? {
      label: provider.charAt(0).toUpperCase() + provider.slice(1),
      logo: provider.slice(0, 1).toUpperCase(),
      color: "var(--surface-3)",
    }
  );
}

export function SharedChatComposer({
  roomId,
  onMessageSent,
}: {
  roomId: string;
  onMessageSent: (message: ImportedConversationMessage) => void;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<
    z.infer<typeof optionsSchema>["options"]
  >([]);
  const [provider, setProvider] = useState("claude");
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewedProvider, setViewedProvider] = useState("claude");
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/rooms/${roomId}/reply-options`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const payload = optionsSchema.parse(await response.json());
        if (controller.signal.aborted) return;
        setOptions(payload.options);
        const first = payload.options[0];
        setProvider(first?.provider ?? "claude");
        setViewedProvider(first?.provider ?? "claude");
        setModel(first?.models[0] ?? "");
      } catch {
        /* Posting remains available when connections cannot load. */
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [roomId]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const viewedModels = useMemo(
    () =>
      options.find((option) => option.provider === viewedProvider)?.models ??
      [],
    [options, viewedProvider],
  );

  function chooseModel(nextProvider: string, nextModel: string) {
    setProvider(nextProvider);
    setModel(nextModel);
    setMenuOpen(false);
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = body.trim();
    if (!message || sending) return;

    setSending(true);
    setError(null);
    const askAI =
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ===
      "ai";
    try {
      const response = await fetch(`/api/rooms/${roomId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: message,
          ...(askAI ? { reply: { provider, model } } : {}),
        }),
      });
      const payload = (await response
        .json()
        .catch(() => null)) as MessageResponse | null;
      if (
        !response.ok ||
        !importedConversationMessageSchema.safeParse(payload?.message).success
      ) {
        setError(payload?.error ?? "The message could not be sent.");
        return;
      }
      setBody("");
      onMessageSent(payload!.message!);
      const reply = importedConversationMessageSchema.safeParse(payload?.reply);
      if (reply.success) onMessageSent(reply.data);
    } catch {
      setError("CoDev could not reach the room. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      className={styles.composer}
      onSubmit={sendMessage}
      aria-busy={sending}
    >
      <label htmlFor="room-message">Add to the conversation</label>
      <div className={styles.composerBox}>
        <textarea
          id="room-message"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onInput={(event) => {
            const el = event.currentTarget;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
          }}
          placeholder="Message the room…  Ask the assistant with Ask AI"
          maxLength={20_000}
          rows={1}
          disabled={sending}
        />
        <div className={styles.composerRow}>
          {options.length ? (
            <div className={styles.modelPicker} ref={pickerRef}>
              <button
                type="button"
                className={styles.modelTrigger}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={`Model: ${model || "select a model"}`}
                disabled={sending}
                onClick={() => {
                  setViewedProvider(provider);
                  setMenuOpen((open) => !open);
                }}
              >
                <span className={styles.dot} />
                {model || "Select model"}
                <ChevronUp className={styles.chev} aria-hidden="true" />
              </button>
              {menuOpen ? (
                <div className={styles.modelMenu} role="menu">
                  <div className={`${styles.modelCol} ${styles.providers}`}>
                    <div className={styles.menuLabel}>Provider</div>
                    {options.map((option) => {
                      const meta = providerMeta(option.provider);
                      const active = option.provider === viewedProvider;
                      return (
                        <button
                          key={option.provider}
                          type="button"
                          className={`${styles.provider} ${
                            active ? styles.active : ""
                          }`}
                          onMouseEnter={() =>
                            setViewedProvider(option.provider)
                          }
                          onClick={() => setViewedProvider(option.provider)}
                        >
                          <span
                            className={styles.providerLogo}
                            style={{ background: meta.color }}
                            aria-hidden="true"
                          >
                            {meta.logo}
                          </span>
                          <span className={styles.name}>{meta.label}</span>
                          <ChevronRight
                            className={styles.chev}
                            aria-hidden="true"
                          />
                        </button>
                      );
                    })}
                  </div>
                  <div className={styles.modelCol}>
                    <div className={styles.menuLabel}>Model</div>
                    {viewedModels.map((value) => {
                      const selected =
                        value === model && viewedProvider === provider;
                      return (
                        <button
                          key={value}
                          type="button"
                          role="menuitemradio"
                          aria-checked={selected}
                          className={`${styles.modelOption} ${
                            selected ? styles.selected : ""
                          }`}
                          onClick={() => chooseModel(viewedProvider, value)}
                        >
                          <span className={styles.radio} aria-hidden="true" />
                          <span>
                            <span className={styles.label}>{value}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <span className={styles.connectHint}>
              {loading ? (
                "Loading subscriptions…"
              ) : (
                <>
                  To ask AI,{" "}
                  <a href="/settings/personal/providers">
                    connect your subscription
                  </a>
                  .
                </>
              )}
            </span>
          )}

          <div className={styles.postGroup}>
            {options.length ? (
              <button
                type="submit"
                value="ai"
                className={styles.askButton}
                disabled={sending || !body.trim() || !model}
              >
                <Sparkles aria-hidden="true" />
                Ask AI
              </button>
            ) : null}
            <button
              type="submit"
              className={styles.postButton}
              disabled={sending || !body.trim()}
            >
              {sending ? (
                <LoaderCircle className={styles.spinner} aria-hidden="true" />
              ) : (
                <Send aria-hidden="true" />
              )}
              {sending ? "Sending…" : "Post"}
            </button>
          </div>
        </div>
      </div>
      <p className={styles.hint}>
        {options.length
          ? "Ask AI replies use your subscription and recent room history — visible to everyone in the room."
          : "Messages are visible to everyone in the room."}
      </p>
      {error ? (
        <p className={styles.composerError} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
