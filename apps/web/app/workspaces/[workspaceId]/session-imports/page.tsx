import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import {
  WorkspaceSessionImportUpload,
  WorkspaceSessionRestoreActions,
} from "@/components/workspace/workspace-session-import-controls";
import { SessionImportMarkdown } from "@/components/workspace/session-import-markdown";
import {
  LONG_MESSAGE_LENGTH,
  SessionImportTranscript,
  sessionMessagePreview,
} from "@/components/workspace/session-import-transcript";
import { OrcaCard, OrcaPageShell } from "@/components/settings/orca-style";
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
    <OrcaPageShell className="max-w-[74rem] gap-6 px-5 py-6 sm:px-8 sm:py-7">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex min-w-0 items-center gap-4">
          <Link
            className="inline-flex min-h-9 w-fit shrink-0 items-center gap-1.5 text-sm text-muted-foreground transition-colors motion-reduce:transition-none hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            href={`/workspaces/${workspaceId}`}
          >
            <ArrowLeft aria-hidden size={15} />
            Workspace
          </Link>
          <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">
            Imported sessions
          </h1>
        </div>
        <details className="relative">
          <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-border/60 bg-card/60 px-3.5 py-1.5 text-sm font-semibold text-foreground transition-colors motion-reduce:transition-none hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
            + Import session
          </summary>
          <div className="absolute right-0 z-10 mt-2 w-[22rem] max-w-[calc(100vw-2.5rem)] space-y-4 rounded-xl border border-border/60 bg-card p-4 shadow-lg">
            <p className="text-sm leading-6 text-muted-foreground">
              Choose a provider and a local session file. CoDev keeps the source
              private and creates a reviewable copy for this workspace.
            </p>
            <WorkspaceSessionImportUpload
              workspaceId={workspaceId}
              canUpload={canRestore}
            />
          </div>
        </details>
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <section aria-labelledby="import-list-heading" className="space-y-1">
          <p
            id="import-list-heading"
            className="mb-2 px-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase"
          >
            Recent imports
          </p>
          {imports.length === 0 ? (
            <OrcaCard className="p-5 text-sm leading-6 text-muted-foreground">
              No imported sessions yet. Choose a session file above to get
              started.
            </OrcaCard>
          ) : (
            <ul className="space-y-0.5 lg:sticky lg:top-6">
              {imports.map((item) => (
                <li key={item.id}>
                  <Link
                    aria-current={item.id === importId ? "page" : undefined}
                    className={`flex min-h-12 flex-col justify-center gap-0.5 rounded-lg border-l-2 px-2.5 py-1.5 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${item.id === importId ? "border-l-primary bg-muted/60" : "border-l-transparent hover:bg-muted/30"}`}
                    href={`${basePath}?import=${item.id}`}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-semibold capitalize text-foreground">
                      <span
                        aria-hidden
                        className={`size-1.5 shrink-0 rounded-full ${
                          item.status === "ready" || item.status === "active"
                            ? "bg-primary"
                            : "bg-muted-foreground/50"
                        }`}
                      />
                      {item.sourceProvider}
                    </span>
                    <span
                      className="truncate pl-3 text-xs text-muted-foreground"
                      title={item.externalSessionId}
                    >
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
          className="min-w-0 space-y-8"
        >
          <h3 id="import-detail-heading" className="sr-only">
            Session view
          </h3>
          {selected ? (
            <>
              <div className="space-y-4 border-b border-border/60 pb-6">
                <div>
                  <h4 className="text-[17px] font-semibold text-foreground">
                    Session imported
                  </h4>
                  <p
                    className="mt-1 text-sm text-muted-foreground"
                    style={{ overflowWrap: "anywhere" }}
                  >
                    <span className="capitalize">
                      {selected.source.provider}
                    </span>{" "}
                    · {selected.transcript.totalEntries} messages ·{" "}
                    {selected.repository.host}/{selected.repository.path} ·{" "}
                    {selected.repository.sourceBranch}
                    <span className="mx-2 text-muted-foreground/50">·</span>
                    Imported {formatDate(selected.createdAt)}
                  </p>
                </div>

                <div className="max-w-[72ch] space-y-2">
                  {selected.handoff.currentObjective.length >
                  LONG_MESSAGE_LENGTH ? (
                    <details className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                      <summary className="min-h-11 cursor-pointer py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                        <span className="block font-medium">
                          Read full objective
                        </span>
                        <span className="mt-1 block text-sm text-muted-foreground">
                          {sessionMessagePreview(
                            selected.handoff.currentObjective,
                          )}
                        </span>
                      </summary>
                      <div className="pt-4">
                        <SessionImportMarkdown
                          text={selected.handoff.currentObjective}
                        />
                      </div>
                    </details>
                  ) : (
                    <p className="text-sm leading-6 text-muted-foreground">
                      Review the imported conversation below, then choose how to
                      continue. Your original session isn&apos;t changed — CoDev
                      keeps a private copy for this workspace.
                    </p>
                  )}
                  <details className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                    <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                      Read handoff summary
                    </summary>
                    <div className="pt-4">
                      <SessionImportMarkdown text={selected.handoff.summary} />
                    </div>
                  </details>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-2 rounded-xl border border-primary/40 bg-primary/[0.07] p-4">
                    <p className="text-sm font-semibold text-foreground">
                      Continue in CoDev
                    </p>
                    <p className="flex-1 text-xs leading-5 text-muted-foreground">
                      Start a new CoDev session using this conversation as
                      context.
                    </p>
                    <button
                      className="inline-flex min-h-9 w-full cursor-not-allowed items-center justify-center rounded-lg bg-primary/50 px-4 text-sm font-medium text-primary-foreground"
                      disabled
                      title="Launch controls are coming in a later step"
                      type="button"
                    >
                      Continue in CoDev
                    </button>
                    <p className="text-center text-[11px] text-muted-foreground/70">
                      Available soon
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 rounded-xl border border-border/60 p-4">
                    <p className="text-sm font-semibold text-foreground">
                      Resume in {selected.source.provider}
                    </p>
                    <p className="flex-1 text-xs leading-5 text-muted-foreground">
                      Reopen the original session with its native history.
                    </p>
                    <button
                      className="inline-flex min-h-9 w-full cursor-not-allowed items-center justify-center rounded-lg border border-border/60 px-4 text-sm font-medium text-muted-foreground"
                      disabled
                      type="button"
                    >
                      Resume session
                    </button>
                    <p className="text-center text-[11px] text-muted-foreground/70">
                      Available soon
                    </p>
                  </div>
                </div>

                <WorkspaceSessionRestoreActions
                  workspaceId={workspaceId}
                  importId={selected.id}
                  status={selected.status}
                  repositoryStatus={selected.repositoryStatus}
                  canRestore={canRestore}
                />
              </div>

              <section>
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h4 className="text-[13px] font-bold tracking-wide text-foreground">
                    Conversation
                  </h4>
                  <span className="text-xs text-muted-foreground">
                    {selected.transcript.entries.length} of{" "}
                    {selected.transcript.totalEntries} messages · read-only
                  </span>
                  {selected.transcript.entries.some(
                    (entry) => entry.text.length > LONG_MESSAGE_LENGTH,
                  ) ? (
                    <p className="basis-full text-xs leading-5 text-muted-foreground">
                      Large source prompts are marked as{" "}
                      <strong className="font-medium text-foreground">
                        imported context
                      </strong>{" "}
                      and collapsed, so they are not mistaken for ordinary
                      messages.
                    </p>
                  ) : null}
                </div>
                <SessionImportTranscript
                  entries={selected.transcript.entries}
                  provider={selected.source.provider}
                />
              </section>
            </>
          ) : (
            <OrcaCard className="p-5 text-sm leading-6 text-muted-foreground">
              Select an import to review its conversation and continue from it.
            </OrcaCard>
          )}
        </section>
      </div>
    </OrcaPageShell>
  );
}
