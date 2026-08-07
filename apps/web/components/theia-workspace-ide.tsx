import { LockKeyhole } from "lucide-react";

import { theiaWorkspaceUrl } from "@/lib/theia";

export function TheiaWorkspaceIde({
  workspaceId,
  canEdit,
}: {
  workspaceId: string;
  canEdit: boolean;
}) {
  return (
    <main className="theia-workspace" aria-label="CoDev Eclipse Theia IDE">
      {canEdit ? (
        <iframe
          title="CoDev Eclipse Theia workspace"
          src={theiaWorkspaceUrl(workspaceId)}
          allow="clipboard-read; clipboard-write"
        />
      ) : (
        <div className="theia-readonly-state">
          <LockKeyhole aria-hidden="true" />
          <strong>Editor access required</strong>
          <p>
            Ask the workspace owner for co-steer access to open the editable IDE
            and its integrated agents.
          </p>
        </div>
      )}
    </main>
  );
}
