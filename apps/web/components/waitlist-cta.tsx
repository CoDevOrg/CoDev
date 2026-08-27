"use client";

import { useEffect, useId, useRef, useState } from "react";

type WaitlistCtaProps = Readonly<{
  triggerClassName: string;
  triggerLabel: string;
}>;

export function WaitlistCta({ triggerClassName, triggerLabel }: WaitlistCtaProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{
    tone: "success" | "warning";
    text: string;
  } | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function submit() {
    setSubmitting(true);
    setStatus(null);
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name: name || undefined }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        setStatus({
          tone: "warning",
          text: payload?.error ?? "That didn't work. Try again in a moment.",
        });
        return;
      }
      setStatus({
        tone: "success",
        text: "You're on the list — check your email for confirmation.",
      });
      setEmail("");
      setName("");
    } catch {
      setStatus({
        tone: "warning",
        text: "That didn't work. Check your connection and try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-expanded={open}
        className={triggerClassName}
        onClick={() => {
          setStatus(null);
          setOpen(true);
        }}
        type="button"
      >
        {triggerLabel} <span aria-hidden="true">↗</span>
      </button>

      <dialog
        aria-labelledby={titleId}
        className="waitlist-dialog"
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onClick={(event) => {
          if (event.target === dialogRef.current) setOpen(false);
        }}
        ref={dialogRef}
      >
        <div className="waitlist-dialog-panel">
          <header className="waitlist-dialog-heading">
            <div>
              <p className="eyebrow">CoDev</p>
              <h2 id={titleId}>Join the waitlist</h2>
            </div>
            <button
              aria-label="Close"
              className="modal-close-button"
              onClick={() => setOpen(false)}
              type="button"
            >
              ×
            </button>
          </header>

          <p className="waitlist-dialog-copy">
            We&apos;re onboarding teams gradually. Join the waitlist and
            we&apos;ll email you when a spot opens up, with free tokens to get
            started.
          </p>

          <form
            className="auth-credentials-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label>
              <span>Name</span>
              <input
                autoComplete="name"
                onChange={(event) => setName(event.target.value)}
                placeholder="Your name (optional)"
                type="text"
                value={name}
              />
            </label>
            <label>
              <span>Email</span>
              <input
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                type="email"
                value={email}
              />
            </label>
            <button className="auth-submit" disabled={submitting} type="submit">
              {submitting ? "Joining…" : "Join waitlist"}
            </button>
            {status ? (
              <p
                className={`form-message ${status.tone === "warning" ? "is-warning" : ""}`}
                role={status.tone === "success" ? "status" : "alert"}
              >
                {status.text}
              </p>
            ) : null}
          </form>
        </div>
      </dialog>
    </>
  );
}
