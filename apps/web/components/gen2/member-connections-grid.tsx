"use client";

import { useEffect, useState } from "react";
import { AlertCircle, LoaderCircle, RotateCw } from "lucide-react";
import type {
  Gen2MemberConnectionStatus,
  Gen2ProviderId,
  Gen2WorkspaceMember,
} from "@codev/contracts";

type Response = { members?: Gen2MemberConnectionStatus[]; error?: string };

const PROVIDER_LABELS: Record<Gen2ProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  cursor: "Cursor",
};

export function Gen2MemberConnectionsGrid({
  members,
  workspaceId,
}: {
  members: Gen2WorkspaceMember[];
  workspaceId: string;
}) {
  const [statuses, setStatuses] = useState<Gen2MemberConnectionStatus[] | null>(
    null,
  );
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    fetch(`/api/gen2/workspaces/${workspaceId}/connection-status`)
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as Response;
        if (!response.ok || !payload.members) {
          throw new Error(payload.error ?? "Could not load member readiness.");
        }
        if (active) {
          setStatuses(payload.members);
          setError("");
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load member readiness.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [workspaceId, retry]);

  const providers =
    statuses?.[0]?.providers.filter(
      (provider) => provider.installed && provider.capabilities.canRun,
    ) ?? [];
  const statusByMember = new Map(
    (statuses ?? []).map((member) => [member.userId, member.providers]),
  );

  return (
    <section
      aria-labelledby="gen2-member-connections-title"
      className="gen2-member-connections"
    >
      <div className="gen2-member-connections-heading">
        <div>
          <h3 id="gen2-member-connections-title">Member readiness</h3>
          <p>
            Which members can run installed providers. This view shows only
            readiness—never provider account identifiers, credentials, or token
            details.
          </p>
        </div>
      </div>

      {error ? (
        <div className="gen2-provider-error" role="alert">
          <AlertCircle aria-hidden="true" size={16} />
          <span>{error}</span>
          <button
            className="gen2-provider-retry"
            onClick={() => setRetry((value) => value + 1)}
            type="button"
          >
            <RotateCw aria-hidden="true" size={14} /> Try again
          </button>
        </div>
      ) : statuses === null ? (
        <p className="gen2-provider-loading" role="status" aria-busy="true">
          <LoaderCircle aria-hidden="true" size={16} /> Loading member
          readiness…
        </p>
      ) : providers.length === 0 ? (
        <p className="gen2-provider-readonly">
          No providers are currently installed for Gen 2.
        </p>
      ) : (
        <div
          aria-label="Member provider readiness"
          className="gen2-member-connections-table-wrap"
          role="region"
          tabIndex={0}
        >
          <table className="gen2-member-connections-table">
            <caption className="gen2-visually-hidden">
              Member readiness for installed Gen 2 providers
            </caption>
            <thead>
              <tr>
                <th scope="col">Member</th>
                {providers.map((provider) => (
                  <th key={provider.id} scope="col">
                    {PROVIDER_LABELS[provider.id]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const readiness = statusByMember.get(member.userId) ?? [];
                return (
                  <tr key={member.userId}>
                    <th scope="row">
                      <span>{member.name || member.login}</span>
                      {member.name ? <small>@{member.login}</small> : null}
                    </th>
                    {providers.map((provider) => {
                      const memberProvider = readiness.find(
                        (item) => item.id === provider.id,
                      );
                      return (
                        <td key={provider.id}>
                          {memberProvider?.ready ? (
                            <span className="gen2-member-ready">Ready</span>
                          ) : memberProvider ? (
                            <span className="gen2-member-not-ready">
                              Not connected
                            </span>
                          ) : (
                            <span className="gen2-member-unknown">
                              Status unavailable
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
