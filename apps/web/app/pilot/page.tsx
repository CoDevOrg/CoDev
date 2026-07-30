import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppChrome } from "@/components/app-chrome";
import { PilotConsole } from "@/components/pilot-console";
import { isPilotAdminLogin } from "@/lib/pilot-access";
import { getPilotConsoleData } from "@/lib/pilot";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Pilot operations" };

export default async function PilotPage() {
  const user = await requireUser();
  if (!isPilotAdminLogin(user.githubLogin)) redirect("/dashboard");

  const data = await getPilotConsoleData();
  return (
    <AppChrome user={user}>
      <main className="pilot-shell">
        <header className="page-title pilot-title">
          <p className="eyebrow">Closed beta operations</p>
          <h1>Run evidence-backed pilot sessions.</h1>
          <p>
            Track operational checkpoints and aggregate product signals without
            collecting source code, prompts, diffs, terminal output, or provider
            credentials.
          </p>
        </header>
        <PilotConsole
          checkpoints={data.checkpoints}
          metrics={data.metrics}
          workspaces={data.workspaces.map((workspace) => ({
            ...workspace,
            lastActivityAt: workspace.lastActivityAt.toISOString(),
          }))}
          sessions={data.sessions.map((session) => ({
            ...session,
            startedAt: session.startedAt.toISOString(),
            completedAt: session.completedAt?.toISOString() ?? null,
          }))}
          feedback={data.feedback.map((item) => ({
            ...item,
            createdAt: item.createdAt.toISOString(),
          }))}
        />
      </main>
    </AppChrome>
  );
}
