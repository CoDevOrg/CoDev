"use client";

import Link from "next/link";
import { useId, useState } from "react";

const PERSONAS = [
  { value: "friends", label: "Building with friends" },
  { value: "startup", label: "Working on a startup" },
  { value: "class", label: "A class or school project" },
  { value: "open_source", label: "Open source" },
  { value: "solo", label: "Solo, for now" },
] as const;

type Status = "idle" | "sending" | "done" | "error";

export function RequestAccessForm() {
  const ids = useId();
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [persona, setPersona] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "sending") return;
    setStatus("sending");
    setMessage("");

    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/access-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(data.get("name") ?? ""),
          email: String(data.get("email") ?? ""),
          ...(persona ? { persona } : {}),
          ...(typeof document !== "undefined" && document.referrer
            ? { referrer: document.referrer.slice(0, 200) }
            : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        alreadyRequested?: boolean;
      };
      if (!response.ok) {
        setStatus("error");
        setMessage(body.error ?? "Something went wrong. Please try again.");
        return;
      }
      setStatus("done");
      setMessage(
        body.alreadyRequested
          ? "You were already on the list. We refreshed your details."
          : "",
      );
    } catch {
      setStatus("error");
      setMessage("We could not reach the server. Please try again.");
    }
  }

  if (status === "done") {
    return (
      <div className="lp-form lp-form-done" role="status">
        <h3>You&apos;re on the list.</h3>
        <p>
          Check your inbox. We just sent a confirmation. When your invite is
          ready, it lands at that same address.
        </p>
        {message ? <small>{message}</small> : null}
        <p className="lp-form-alt">
          Already have an invite? <Link href="/sign-in">Sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <form className="lp-form" onSubmit={submit} noValidate={false}>
      <div className="lp-field">
        <label htmlFor={`${ids}-email`}>Email</label>
        <input
          id={`${ids}-email`}
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={320}
          placeholder="you@gmail.com"
        />
        <small>We&apos;ll send your invite here.</small>
      </div>

      <div className="lp-field">
        <label htmlFor={`${ids}-name`}>Name (optional)</label>
        <input
          id={`${ids}-name`}
          name="name"
          type="text"
          autoComplete="name"
          maxLength={120}
          placeholder="Ada Lovelace"
        />
      </div>

      <fieldset className="lp-field lp-personas">
        <legend>What are you building? (optional)</legend>
        <div>
          {PERSONAS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={persona === option.value}
              className={persona === option.value ? "is-active" : undefined}
              onClick={() =>
                setPersona((current) =>
                  current === option.value ? null : option.value,
                )
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      {status === "error" ? (
        <p className="lp-form-error" role="alert">
          {message}
        </p>
      ) : null}

      <div className="lp-form-actions">
        <button
          className="lp-cta lp-cta-primary"
          type="submit"
          disabled={status === "sending"}
        >
          {status === "sending" ? "Sending…" : "Request access"}
        </button>
        <p>
          Already have an invite? <Link href="/sign-in">Sign in</Link>
        </p>
      </div>
    </form>
  );
}
