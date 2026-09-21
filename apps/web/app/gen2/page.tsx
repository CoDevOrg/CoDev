import type { Metadata } from "next";
import Link from "next/link";

import { CreateGen2WorkspaceForm } from "@/components/gen2/create-workspace-form";
import { AppChrome } from "@/components/shell/app-chrome";
import { requireUser } from "@/lib/auth/session";
import { listGen2WorkspacesForUser } from "@/lib/gen2/workspaces";

export const metadata: Metadata = { title: "Gen 2 workspaces" };

const STATUS_LABEL = {
  pending: "Not started",
  provisioning: "Starting",
  ready: "Running",
  failed: "Failed",
  stopped: "Stopped",
} as const;

export default async function Gen2WorkspacesPage() {
  const user = await requireUser("/gen2");
  const workspaces = await listGen2WorkspacesForUser(user.id);

  return (
    <AppChrome user={user} sidebar>
      <main className="gen2-shell">
        <p className="eyebrow">Gen 2</p>
        <h1>Cloud workspaces</h1>
        <p className="gen2-lede">
          A workspace is a Firecracker instance you can share. Start one, send
          the link, and anyone you invite can join the same machine.
        </p>
        <CreateGen2WorkspaceForm />
        {workspaces.length === 0 ? (
          <p className="gen2-empty">No workspaces yet.</p>
        ) : (
          <ul className="gen2-list">
            {workspaces.map((workspace) => (
              <li key={workspace.id}>
                <Link className="gen2-card" href={`/gen2/${workspace.id}`}>
                  <strong>{workspace.name}</strong>
                  <span
                    className={`gen2-status gen2-status-${workspace.status}`}
                  >
                    <span className="gen2-status-dot" aria-hidden="true" />
                    {STATUS_LABEL[workspace.status]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </AppChrome>
  );
}
