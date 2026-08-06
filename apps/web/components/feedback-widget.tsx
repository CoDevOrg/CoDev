"use client";

import { MessageSquarePlus, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

export function FeedbackWidget({
  workspaceId = null,
}: {
  workspaceId?: string | null;
}) {
  const pathname = usePathname();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("workflow");
  const [rating, setRating] = useState("5");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<{
    tone: "success" | "warning";
    text: string;
    issueUrl?: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

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
    setSaving(true);
    setStatus(null);
    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category,
        rating: rating ? Number(rating) : null,
        message,
        page: pathname ?? null,
        workspaceId,
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      warning?: string;
      issueUrl?: string | null;
    } | null;
    if (!response.ok) {
      setStatus({
        tone: "warning",
        text: payload?.error ?? "Feedback could not be submitted.",
      });
      setSaving(false);
      return;
    }

    setMessage("");
    if (payload?.issueUrl) {
      setStatus({
        tone: "success",
        text: "Thanks — a GitHub issue was opened from your feedback.",
        issueUrl: payload.issueUrl,
      });
    } else {
      setStatus({
        tone: "warning",
        text:
          payload?.warning ??
          "Feedback was saved, but a GitHub issue was not created.",
      });
    }
    setSaving(false);
  }

  return (
    <div className="feedback-widget">
      <button
        aria-haspopup="dialog"
        aria-expanded={open}
        className="feedback-fab"
        onClick={() => {
          setStatus(null);
          setOpen(true);
        }}
        type="button"
      >
        <MessageSquarePlus aria-hidden="true" />
        <span>Feedback</span>
      </button>

      <dialog
        aria-labelledby={titleId}
        className="feedback-dialog"
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onClick={(event) => {
          if (event.target === dialogRef.current) setOpen(false);
        }}
        ref={dialogRef}
      >
        <div className="feedback-dialog-panel">
          <header className="feedback-dialog-heading">
            <div>
              <p className="eyebrow">CoDev</p>
              <h2 id={titleId}>Send feedback</h2>
            </div>
            <button
              aria-label="Close feedback"
              className="modal-close-button"
              onClick={() => setOpen(false)}
              type="button"
            >
              <X aria-hidden="true" />
            </button>
          </header>

          <div className="feedback-form">
            <div className="feedback-grid">
              <label>
                <span>Category</span>
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                >
                  <option value="workflow">Workflow</option>
                  <option value="bug">Bug</option>
                  <option value="feature">Feature request</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                <span>Experience</span>
                <select
                  value={rating}
                  onChange={(event) => setRating(event.target.value)}
                >
                  <option value="">Not rated</option>
                  <option value="5">5 — Excellent</option>
                  <option value="4">4 — Good</option>
                  <option value="3">3 — Okay</option>
                  <option value="2">2 — Difficult</option>
                  <option value="1">1 — Blocked</option>
                </select>
              </label>
            </div>
            <label>
              <span>What happened?</span>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                minLength={10}
                maxLength={2_000}
                placeholder="Tell us what worked, what blocked you, or what would make CoDev useful for your team."
              />
            </label>
            <div className="form-actions">
              <button
                className="primary-button"
                type="button"
                disabled={saving || message.trim().length < 10}
                onClick={() => void submit()}
              >
                {saving ? "Submitting…" : "Send feedback"}
              </button>
            </div>
            {status ? (
              <p
                className={`form-message ${status.tone === "warning" ? "is-warning" : ""}`}
                role={status.tone === "success" ? "status" : "alert"}
              >
                {status.text}
                {status.issueUrl ? (
                  <>
                    {" "}
                    <a href={status.issueUrl} rel="noreferrer" target="_blank">
                      View issue
                    </a>
                  </>
                ) : null}
              </p>
            ) : null}
            <p className="security-note">
              Do not include source code, prompts, terminal output, or
              credentials. Submissions open a GitHub issue automatically.
            </p>
          </div>
        </div>
      </dialog>
    </div>
  );
}

/** @deprecated Use FeedbackWidget — kept for any remaining imports. */
export function FeedbackForm() {
  return <FeedbackWidget />;
}
