"use client";

import { useState } from "react";

export type AgentBugReportContext = {
  cycles: Array<{ prompt: string; response: string }>;
  terminalErrors: string[];
};

export function ReportAgentBug({
  workspaceId,
  getContext,
}: {
  workspaceId: string;
  getContext(): AgentBugReportContext;
}) {
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function report() {
    setSubmitting(true);
    setStatus("");
    const context = getContext();
    const response = await fetch(
      `/api/workspaces/${workspaceId}/agent-bug-reports`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...context,
          userAgent: navigator.userAgent,
        }),
      },
    );
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    setStatus(
      response.ok
        ? "Report sent. Thank you."
        : (body?.error ?? "The report could not be sent."),
    );
    setSubmitting(false);
  }

  return (
    <div className="agent-bug-report">
      <button type="button" onClick={() => void report()} disabled={submitting}>
        {submitting ? "Reporting…" : "Report agent bug"}
      </button>
      {status ? <span role="status">{status}</span> : null}
    </div>
  );
}
