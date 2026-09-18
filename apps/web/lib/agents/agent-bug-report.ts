import "server-only";

type AgentBugReport = {
  reportId: string;
  workspaceId: string;
  userId: string;
  userAgent: string;
  cycles: Array<{ prompt: string; response: string }>;
  terminalErrors: string[];
};

function sentryEnvelope(report: AgentBugReport) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return null;
  const parsed = new URL(dsn);
  const projectId = parsed.pathname.split("/").filter(Boolean).pop();
  if (!projectId) return null;
  const path = parsed.pathname.slice(0, -projectId.length);
  const endpoint = `${parsed.protocol}//${parsed.host}${path}api/${projectId}/envelope/`;
  const header = {
    event_id: report.reportId.replaceAll("-", ""),
    sent_at: new Date().toISOString(),
    dsn,
  };
  const event = {
    event_id: header.event_id,
    level: "error",
    platform: "javascript",
    message: "Agent bug report",
    tags: { workspace_id: report.workspaceId, report_source: "agent_canvas" },
    user: { id: report.userId },
    contexts: { browser: { name: report.userAgent.slice(0, 512) } },
    extra: { cycles: report.cycles, terminal_errors: report.terminalErrors },
  };
  return {
    endpoint,
    body: `${JSON.stringify(header)}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}\n`,
  };
}

/** Delivers telemetry without persisting potentially sensitive thread content. */
export async function submitAgentBugReport(report: AgentBugReport) {
  const jobs: Promise<Response>[] = [];
  const posthogKey = process.env.POSTHOG_API_KEY;
  if (posthogKey) {
    jobs.push(
      fetch("https://us.i.posthog.com/capture/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: posthogKey,
          event: "agent_bug_reported",
          properties: {
            distinct_id: report.userId,
            report_id: report.reportId,
            workspace_id: report.workspaceId,
            recent_cycles: report.cycles,
            terminal_errors: report.terminalErrors,
            user_agent: report.userAgent,
          },
        }),
      }),
    );
  }
  const sentry = sentryEnvelope(report);
  if (sentry) {
    jobs.push(
      fetch(sentry.endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-sentry-envelope" },
        body: sentry.body,
      }),
    );
  }
  await Promise.allSettled(jobs);
}
