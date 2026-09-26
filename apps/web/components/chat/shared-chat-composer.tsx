"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, ChevronUp, LoaderCircle, Send } from "lucide-react";

import {
  importedConversationMessageSchema,
  type ImportedConversationMessage,
} from "@codev/contracts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/platform/utils";

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
  claude: { label: "Claude", logo: "A", color: "var(--color-orange)" },
  codex: { label: "OpenAI Codex", logo: "O", color: "var(--color-teal)" },
};

function providerMeta(provider: string) {
  return (
    PROVIDER_META[provider] ?? {
      label: provider.charAt(0).toUpperCase() + provider.slice(1),
      logo: provider.slice(0, 1).toUpperCase(),
      color: "var(--color-muted-foreground)",
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
    // Sending always asks the assistant to reply when a subscription and model
    // are available; without one the message just posts to the room.
    const askAI = options.length > 0 && Boolean(model);
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
      onSubmit={sendMessage}
      aria-busy={sending}
      className="flex flex-col gap-2 border-t border-border px-6 py-4"
    >
      <label htmlFor="room-message" className="sr-only">
        Add to the conversation
      </label>
      <div className="rounded-2xl border border-input bg-card px-4 py-3 focus-within:border-ring">
        <Textarea
          id="room-message"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onInput={(event) => {
            const el = event.currentTarget;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
          }}
          placeholder="Message the room…"
          maxLength={20_000}
          rows={1}
          disabled={sending}
          className="min-h-6"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          {options.length ? (
            <div className="relative" ref={pickerRef}>
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={`Model: ${model || "select a model"}`}
                disabled={sending}
                onClick={() => {
                  setViewedProvider(provider);
                  setMenuOpen((open) => !open);
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-transparent px-2.5 py-1 text-[11.5px] font-semibold text-muted-foreground hover:border-input"
              >
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-teal"
                />
                {model || "Select model"}
                <ChevronUp
                  aria-hidden="true"
                  className={`size-3 transition-transform ${menuOpen ? "" : "rotate-180"}`}
                />
              </button>
              <AnimatePresence>
                {menuOpen ? (
                  <motion.div
                    role="menu"
                    initial={{ opacity: 0, y: 6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.98 }}
                    transition={{ duration: 0.14 }}
                    className="absolute bottom-full left-0 z-20 mb-2 flex w-72 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl shadow-foreground/10"
                  >
                    <div className="flex w-1/2 flex-col gap-0.5 border-r border-border p-1.5">
                      <div className="px-2 py-1 text-[10px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
                        Provider
                      </div>
                      {options.map((option) => {
                        const meta = providerMeta(option.provider);
                        const active = option.provider === viewedProvider;
                        return (
                          <button
                            key={option.provider}
                            type="button"
                            onMouseEnter={() =>
                              setViewedProvider(option.provider)
                            }
                            onClick={() => setViewedProvider(option.provider)}
                            className={cn(
                              "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] font-medium",
                              active ? "bg-muted" : "hover:bg-muted/60",
                            )}
                          >
                            <span
                              aria-hidden="true"
                              style={{ background: meta.color }}
                              className="flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                            >
                              {meta.logo}
                            </span>
                            <span className="flex-1 truncate">
                              {meta.label}
                            </span>
                            <ChevronRight
                              aria-hidden="true"
                              className="size-3 text-muted-foreground"
                            />
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex w-1/2 flex-col gap-0.5 p-1.5">
                      <div className="px-2 py-1 text-[10px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
                        Model
                      </div>
                      {viewedModels.map((value) => {
                        const selected =
                          value === model && viewedProvider === provider;
                        return (
                          <button
                            key={value}
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            onClick={() => chooseModel(viewedProvider, value)}
                            className={cn(
                              "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px]",
                              selected
                                ? "bg-muted font-semibold"
                                : "hover:bg-muted/60",
                            )}
                          >
                            <span
                              aria-hidden="true"
                              className={cn(
                                "size-2.5 shrink-0 rounded-full border",
                                selected
                                  ? "border-primary bg-primary"
                                  : "border-input",
                              )}
                            />
                            <span className="truncate">{value}</span>
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          ) : (
            <span className="text-[11.5px] text-muted-foreground">
              {loading ? (
                "Loading subscriptions…"
              ) : (
                <>
                  To ask AI,{" "}
                  <a
                    href="/settings/personal/providers"
                    style={{ color: "var(--color-primary)" }}
                    className="hover:underline"
                  >
                    connect your subscription
                  </a>
                  .
                </>
              )}
            </span>
          )}

          <Button
            type="submit"
            disabled={sending || !body.trim()}
            className="h-8 rounded-full px-3.5 text-xs"
          >
            {sending ? (
              <LoaderCircle
                className="size-3.5 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Send aria-hidden="true" className="size-3.5" />
            )}
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>
      <p className="m-0 text-[11px] text-muted-foreground">
        {options.length
          ? "Sending posts to the room and asks the assistant to reply, using your subscription and recent room history — visible to everyone."
          : "Messages are visible to everyone in the room."}
      </p>
      {error ? (
        <p role="alert" className="m-0 text-[11.5px] text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
