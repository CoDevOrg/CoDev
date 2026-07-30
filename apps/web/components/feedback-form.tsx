"use client";

import { useState } from "react";

export function FeedbackForm() {
  const [category, setCategory] = useState("workflow");
  const [rating, setRating] = useState("5");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setStatus("");
    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category,
        rating: rating ? Number(rating) : null,
        message,
        page: "/settings",
        workspaceId: null,
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    if (!response.ok) {
      setStatus(payload?.error ?? "Feedback could not be submitted.");
      setSaving(false);
      return;
    }
    setMessage("");
    setStatus("Thank you—your feedback was saved for the CoDev launch review.");
    setSaving(false);
  }

  return (
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
      {status ? <p className="form-message">{status}</p> : null}
      <p className="security-note">
        Do not include source code, prompts, terminal output, or credentials.
      </p>
    </div>
  );
}
