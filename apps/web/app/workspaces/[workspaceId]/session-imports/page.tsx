import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import {
  WorkspaceSessionImportUpload,
  WorkspaceSessionRestoreActions,
} from "@/components/workspace/workspace-session-import-controls";
import {
  OrcaCard,
  OrcaPageHeader,
  OrcaPageShell,
} from "@/components/settings/orca-style";
import {
  listStoredSessionImports,
  readStoredSessionImportView,
} from "@/lib/agents/session-import-view";
import { SessionImportStorageError } from "@/lib/agents/session-import-storage";
import { permissionsForRole } from "@/lib/auth/access";
import { requireUser } from "@/lib/auth/session";
import { getWorkspaceForMember } from "@/lib/workspaces/workspaces";

export const metadata: Metadata = { title: "Imported sessions" };

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

export default async function WorkspaceSessionImportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ import?: string | string[] }>;
}) {
  const user = await requireUser();
  const { workspaceId } = await params;
  const workspace = await getWorkspaceForMember(workspaceId, user.id);
  if (!workspace) notFound();
  const canRestore = permissionsForRole(workspace.accessRole).coSteer;

  const requestedImport = (await searchParams).import;
  const importId = Array.isArray(requestedImport)
    ? requestedImport[0]
    : requestedImport;
  if (
    importId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      importId,
    )
  ) {
    notFound();
  }

  const imports = await listStoredSessionImports({
    workspaceId,
    importedBy: user.id,
  });
  let selected = null;
  if (importId) {
    try {
      selected = await readStoredSessionImportView({
        workspaceId,
        importId,
        importedBy: user.id,
      });
    } catch (error) {
      if (error instanceof SessionImportStorageError && error.status === 404) {
        notFound();
      }
      throw error;
    }
  }

  const basePath = `/workspaces/${workspaceId}/session-imports`;
  return (
    <OrcaPageShell>
      <Link
        className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-muted-foreground transition-colors motion-reduce:transition-none hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        href={`/workspaces/${workspaceId}`}
      >
        <ArrowLeft aria-hidden size={16} />
        Back to workspace
      </Link>
      <OrcaPageHeader
        title="Imported sessions"
        description="Bring a coding-agent session into this workspace, inspect its handoff, and choose how to handle its repository state."
      />

      <OrcaCard className="space-y-4 p-5 sm:p-6">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-foreground">
            Import a session
          </h3>
          <p className="text-sm leading-6 text-muted-foreground">
            Choose a provider and a local session file. CoDev creates a private
            provider payload and a normalized view for this workspace.
          </p>
        </div>
        <WorkspaceSessionImportUpload
          workspaceId={workspaceId}
          canUpload={canRestore}
        />
      </OrcaCard>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        <section aria-labelledby="import-list-heading" className="space-y-3">
          <h3
            id="import-list-heading"
            className="text-sm font-semibold text-foreground"
          >
            Your recent imports
          </h3>
          {imports.length === 0 ? (
            <OrcaCard className="p-5 text-sm leading-6 text-muted-foreground">
              No imported sessions yet. Choose a session file above to get
              started.
            </OrcaCard>
          ) : (
            <ul className="space-y-2">
              {imports.map((item) => (
                <li key={item.id}>
                  <Link
                    aria-current={item.id === importId ? "page" : undefined}
                    className={`block min-h-11 rounded-xl border p-4 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${item.id === importId ? "border-primary/50 bg-primary/5" : "border-border/60 bg-card/50 hover:bg-muted/60"}`}
                    href={`${basePath}?import=${item.id}`}
                  >
                    <span className="block text-sm font-medium capitalize text-foreground">
                      {item.sourceProvider}
                    </span>
                    <span
                      className="mt-1 block truncate text-xs text-muted-foreground"
                      title={item.externalSessionId}
                    >
                      {item.externalSessionId}
                    </span>
                    <span className="mt-2 block text-xs text-muted-foreground">
                      {statusLabel(item.status)} · {formatDate(item.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-labelledby="import-detail-heading"
          className="min-w-0 space-y-4"
        >
          <h3
            id="import-detail-heading"
            className="text-sm font-semibold text-foreground"
          >
            Session view
          </h3>
          {selected ? (
            <>
              <OrcaCard className="space-y-5 p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      {selected.source.provider} import
                    </p>
                    <h4
                      className="text-lg font-semibold text-foreground"
                      style={{ overflowWrap: "anywhere" }}
                    >
                      {selected.handoff.currentObjective}
                    </h4>
                  </div>
                  <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium capitalize text-foreground">
                    {statusLabel(selected.status)}
                  </span>
                </div>
                <p
                  className="whitespace-pre-wrap text-sm leading-6 text-foreground"
                  style={{ overflowWrap: "anywhere" }}
                >
                  {selected.handoff.summary}
                </p>
                <div className="grid gap-3 border-t border-border/60 pt-4 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Repository</p>
                    <p
                      className="mt-1 text-foreground"
                      style={{ overflowWrap: "anywhere" }}
                    >
                      {selected.repository.host}/{selected.repository.path}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Repository state
                    </p>
                    <p className="mt-1 capitalize text-foreground">
                      {statusLabel(selected.repositoryStatus)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Source branch
                    </p>
                    <p
                      className="mt-1 text-foreground"
                      style={{ overflowWrap: "anywhere" }}
                    >
                      {selected.repository.sourceBranch}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Imported</p>
                    <p className="mt-1 text-foreground">
                      {formatDate(selected.createdAt)}
                    </p>
                  </div>
                </div>
                <WorkspaceSessionRestoreActions
                  workspaceId={workspaceId}
                  importId={selected.id}
                  status={selected.status}
                  repositoryStatus={selected.repositoryStatus}
                  canRestore={canRestore}
                  sourceProvider={selected.source.provider}
                />
              </OrcaCard>

              <OrcaCard className="space-y-4 p-5 sm:p-6">
                <div>
                  <h4 className="text-base font-semibold text-foreground">
                    Transcript
                  </h4>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Showing the latest {selected.transcript.entries.length} of{" "}
                    {selected.transcript.totalEntries} entries.
                  </p>
                </div>
                <ol className="space-y-4">
                  {selected.transcript.entries.map((entry) => (
                    <li
                      key={entry.sequence}
                      className="border-t border-border/60 pt-4 first:border-0 first:pt-0"
                    >
                      <p className="text-xs font-semibold capitalize text-muted-foreground">
                        {entry.authorName || entry.role}
                      </p>
                      <p
                        className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground"
                        style={{ overflowWrap: "anywhere" }}
                      >
                        {entry.text}
                      </p>
                    </li>
                  ))}
                </ol>
              </OrcaCard>
            </>
          ) : (
            <OrcaCard className="p-5 text-sm leading-6 text-muted-foreground">
              Select an import to review its handoff and repository status.
            </OrcaCard>
          )}
        </section>
      </div>
    </OrcaPageShell>
  );
}
