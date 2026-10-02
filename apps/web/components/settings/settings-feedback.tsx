"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

import { cn } from "@/lib/platform/utils";

type Tone = "success" | "error";
type Toast = { id: number; tone: Tone; text: string };

const DISMISS_MS = 5000;

const FeedbackContext = createContext<
  ((text: string, tone?: Tone) => void) | null
>(null);

/**
 * Toast notifier for the settings area, or `null` outside a
 * `SettingsFeedbackProvider`. Callers that can render without the provider
 * (unit tests, stories) fall back to an inline message.
 */
export function useSettingsNotify() {
  return useContext(FeedbackContext);
}

/**
 * Result messages used to render as 11px grey text at the bottom of whichever
 * card was clicked, well out of view on a long page. A toast lands in one
 * fixed place regardless of scroll position and announces politely to screen
 * readers without stealing focus.
 */
export function SettingsFeedbackProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (text: string, tone: Tone = "success") => {
      const id = (nextId.current += 1);
      setToasts((current) => [...current.slice(-2), { id, tone, text }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DISMISS_MS),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const active = timers.current;
    return () => {
      for (const timer of active.values()) clearTimeout(timer);
    };
  }, []);

  const value = useMemo(() => notify, [notify]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            className={cn(
              "pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-card px-3.5 py-3 text-sm shadow-lg",
              toast.tone === "error"
                ? "border-destructive/50"
                : "border-border",
            )}
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
          >
            {toast.tone === "error" ? (
              <AlertCircle
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-destructive"
              />
            ) : (
              <CheckCircle2
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-emerald-400"
              />
            )}
            <p className="min-w-0 flex-1 break-words">{toast.text}</p>
            <button
              aria-label="Dismiss notification"
              className="-m-1.5 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => dismiss(toast.id)}
              type="button"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </FeedbackContext.Provider>
  );
}
