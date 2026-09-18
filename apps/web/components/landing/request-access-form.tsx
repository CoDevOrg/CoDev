"use client";

import { useId, useState } from "react";

type Status = "idle" | "sending" | "done" | "error";

/** Answers for "What will you use CoDev for?": optional, "Other" included. */
const USE_CASES = [
  "A side project",
  "A startup or product",
  "Client or freelance work",
  "Learning or school",
  "Hackathon or game jam",
  "Other",
] as const;

export function RequestAccessForm() {
  const ids = useId();
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

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
          email: String(data.get("email") ?? ""),
          name: String(data.get("name") ?? ""),
          building: String(data.get("building") ?? ""),
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
          Check your inbox for confirmation. We&apos;ll send your invite to the
          same address when it&apos;s ready.
        </p>
        {message ? <small>{message}</small> : null}
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
        <label htmlFor={`${ids}-name`}>
          Name <span>Optional</span>
        </label>
        <input
          id={`${ids}-name`}
          name="name"
          type="text"
          autoComplete="name"
          maxLength={120}
          placeholder="What should we call you?"
        />
      </div>

      <fieldset className="lp-field lp-field-choices">
        <legend>
          What will you use CoDev for? <span>Optional</span>
        </legend>
        <div className="lp-choices">
          {USE_CASES.map((useCase) => (
            <label key={useCase} className="lp-choice">
              <input type="radio" name="building" value={useCase} />
              <span>{useCase}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {status === "error" ? (
        <p className="lp-form-error" role="alert">
          {message}
        </p>
      ) : null}

      <button
        className="lp-cta lp-cta-primary lp-form-submit"
        type="submit"
        disabled={status === "sending"}
      >
        {status === "sending" ? "Joining…" : "Join the waitlist"}
      </button>
    </form>
  );
}
