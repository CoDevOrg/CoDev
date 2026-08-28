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
  const [githubLogin, setGithubLogin] = useState("");

  const handle = githubLogin.trim().replace(/^@/, "");
  const validHandle = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(
    handle,
  );

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
          githubLogin: String(data.get("githubLogin") ?? ""),
          building: String(data.get("building") ?? ""),
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
          ? "You were already on the list — we refreshed your details."
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
        <span className="lp-form-check" aria-hidden="true">
          ✓
        </span>
        <h3>You&apos;re on the list.</h3>
        <p>
          Check your inbox — we just sent a confirmation. When your invite is
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
      <div className="lp-field-row">
        <div className="lp-field">
          <label htmlFor={`${ids}-name`}>Name</label>
          <input
            id={`${ids}-name`}
            name="name"
            type="text"
            autoComplete="name"
            required
            maxLength={120}
            placeholder="Ada Lovelace"
          />
        </div>
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
          <small>Use the Google or GitHub email you&apos;ll sign in with.</small>
        </div>
      </div>

      <div className="lp-field">
        <label htmlFor={`${ids}-github`}>GitHub username (optional)</label>
        <div className="lp-github-field">
          <span aria-hidden="true">@</span>
          <input
            id={`${ids}-github`}
            name="githubLogin"
            type="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={40}
            placeholder="ada"
            value={githubLogin}
            onChange={(event) => setGithubLogin(event.target.value)}
          />
          {handle && validHandle ? (
            // github.com serves a public avatar for any handle, so this
            // previews the account without an API call or a token.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`https://github.com/${handle}.png?size=64`}
              alt=""
              width={28}
              height={28}
              loading="lazy"
            />
          ) : null}
        </div>
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

      <div className="lp-field">
        <label htmlFor={`${ids}-building`}>
          Tell us about the project (optional)
        </label>
        <textarea
          id={`${ids}-building`}
          name="building"
          rows={3}
          maxLength={500}
          placeholder="Two of us are building a booking app for our campus club…"
        />
      </div>

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
          <span aria-hidden="true">↗</span>
        </button>
        <p>
          Already have an invite? <Link href="/sign-in">Sign in</Link>
        </p>
      </div>
    </form>
  );
}
