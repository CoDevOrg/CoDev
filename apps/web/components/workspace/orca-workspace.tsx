"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { History, Share2 } from "lucide-react";
import { track } from "@vercel/analytics";

import {
  EMPTY_CODEV_PARENT_BRIDGE_SESSION,
  executeCodevBridgeRequest,
  isCodevBridgeClientMessage,
  isCodevBridgeRequestMessage,
  replyToCodevBridgeMessage,
  type CodevParentBridgeSession,
} from "@/components/workspace/codev-parent-bridge";
import { useLiveAgentActivity } from "@/components/workspace/workspace-agent-activity";
import { watchOrcaProjectTree } from "@/components/workspace/orca-project-tree";
import { WorkspaceRepositoryDialog } from "@/components/workspace/workspace-repository-dialog";
import { WorkspaceShareDialog } from "@/components/workspace/workspace-share-dialog";
import { ProviderPreflightBanner } from "@/components/workspace/provider-preflight-banner";
import {
  workspaceProviderReadiness,
  type WorkspaceProviderPreflight,
} from "@/lib/providers/provider-surface-capability";
import type { WorkspaceCreditStatus } from "@/lib/runtime/compute-credits";
import { refreshWorkspaceProviderPreflight } from "@/lib/providers/refresh-workspace-provider-preflight";
import { MAX_PARALLEL_AGENT_SESSIONS } from "@codev/contracts";

type ConnectionPhase =
  | { phase: "connecting" }
  | { phase: "host-starting" }
  // The host is up and a pairing offer is in hand. The iframe is already
  // mounted (it booted from the static bundle the moment this component did),
  // so we hand it the pairing over `postMessage` rather than swapping its src.
  | { phase: "ready" }
  | { phase: "error"; message: string };

/** Late pairing details posted into the already-running iframe once the host
 *  answers. Mirrors the fragment `buildOrcaIframeSource` used to encode. */
type PendingPair = {
  pairingCode: string;
  workspacePath: string;
  memberId?: string;
};

/**
 * Poll fast while the host comes up. The wake path is idempotent and cheap
 * (a DescribeInstances plus, at most, one StartInstances), so a tight poll
 * buys a noticeably quicker hand-off the moment the instance is ready
 * without meaningfully more work on the server.
 */
const HOST_STARTING_RETRY_MS = 2_500;
/**
 * How long to keep waiting before admitting the wait is unusual. Anything
 * that resolves on its own - a cold boot, a capacity retry, an orchestrator
 * still starting its services - lands well inside this, so crossing it just
 * softens the copy rather than turning into an error.
 */
const SLOW_START_NOTICE_MS = 90_000;
/**
 * Keepalive cadence for an open IDE. Comfortably under the host's idle
 * window, and paused while the tab is hidden so a forgotten background tab
 * does not hold the instance open indefinitely.
 */
const IDE_KEEPALIVE_MS = 60_000;
// How often the host-wake state is re-sent to the iframe while it is starting.
const HOST_STATE_REPORT_MS = 2_000;
/**
 * The only connect failures worth showing: signing in, being granted access,
 * a workspace that is gone, and running out of credit are all things the
 * person can do something about. Every other status is infrastructure and is
 * retried silently.
 */
// A 400 from the runtime is a request/configuration problem, not a cold-start
// condition. Retrying it forever hides the useful server message (for
// example, a provider credential that cannot be used by the shared IDE).
const ACTIONABLE_CONNECT_STATUSES = new Set([400, 401, 403, 404, 429]);

export function isActionableOrcaConnectStatus(status: number): boolean {
  return ACTIONABLE_CONNECT_STATUSES.has(status);
}
/**
 * Bound on a single connect request. Without one, a request that never
 * settled kept the starting state up forever with nothing to report.
 *
 * It has to sit above what a legitimate attempt costs, which is why it is
 * this large. A request that finds the host already running goes on to spawn
 * this workspace's Orca process and clone its repository, and `startIde`
 * allows that 110 seconds. The 20 seconds this used to be aborted that spawn
 * halfway through: the next attempt then found the half-started process,
 * tore it down and began again (`startIdeRecoveringStaleProcess`), so the
 * timeout meant to report a stuck request was itself making the workspace
 * slower to open — and putting "no answer within 20s" on screen while the
 * runtime was working normally.
 *
 * Waiting is free here because nothing else can proceed anyway, and the
 * cold-start path no longer relies on it: a host that is not serving yet is
 * answered as `host-starting` within seconds (OPEN_PATH_ORCHESTRATOR_WAIT_MS
 * in lib/runtime/orca-host.ts) and polled on HOST_STARTING_RETRY_MS.
 */
const CONNECT_REQUEST_TIMEOUT_MS = 120_000;
/**
 * Consecutive genuine failures - not "still starting" answers - before the
 * waiting copy names the failure instead of describing a normal boot.
 */
const CONNECT_FAILURE_NOTICE_ATTEMPTS = 3;
/**
 * After this long of nothing but failures, waiting will not help: the wait
 * becomes the error screen, with the last reason and a Retry.
 */
const CONNECT_FAILURE_ESCALATE_MS = 6 * 60_000;
const ORCA_THEME_OVERRIDE_HREF = "/orca-theme-overrides.css";
const CODEV_EMPTY_STATE_LOGO_SRC = "/brand/codev-mark-v3.png";
/** The embedded IDE bundle. Served from this origin, so it is known and
 *  loadable before the workspace's EC2 host has finished waking. */
const ORCA_WEB_CLIENT_PATH = "/orca/web-index.html";
/**
 * How long to keep the loading skeleton up when the iframe never reports
 * `codev:shell-ready` (an older bundle, or a shell that failed to paint). By
 * this point the pairing has usually landed and the iframe is the real IDE, so
 * revealing it is the right call rather than skeletoning forever.
 */
const SHELL_READY_FALLBACK_MS = 8_000;

type OrcaConnectResponse = {
  /** "ready" | "host-starting" | "unavailable" — see the orca route. */
  state?: string;
  pairingCode?: string;
  webClientPath?: string;
  workspacePath?: string | null;
  memberId?: string;
  error?: string;
};

type CodevOrcaMessage =
  | { type: "codev:choose-repository" }
  | { type: "codev:shell-ready" }
  | { type: "codev:project-ready" }
  | { type: "codev:project-error"; message?: string }
  | { type: "codev:startup-failure"; step?: string | null; message?: string }
  | {
      type: "codev:agent-count";
      /** Agents doing work right now. */
      active?: number;
      /** Agent sessions open but idle between turns. */
      idle?: number;
      /** `active + idle`. The only field an older bundle sends, where it means
       *  "rows in Mission Control" — which is why it is not an agent count. */
      count?: number;
      slotsUsed?: number;
      slotsTotal?: number;
    }
  | { type: "codev:retry-connect" }
  | { type: "codev:provider-readiness-refresh" }
  | { type: "codev:branch-route"; branch: string | null }
  | {
      type: "codev:agent-route";
      branch: string | null;
      agent: string | null;
    }
  | {
      type: "codev:discard-proposal";
      requestId: string;
      worktreeId: string;
    }
  | { type: "codev:create-proposal"; requestId: string }
  | { type: "codev:bridge-hello"; generation: number }
  | { type: "codev:bridge-ping"; generation: number }
  | { type: "codev:bridge-interrupt"; generation: number }
  | {
      type: "codev:bridge-request";
      generation: number;
      requestId: string;
      method:
        | "invites.list"
        | "invites.create"
        | "invites.revoke"
        | "members.update";
      params?: Record<string, unknown>;
    };

type CodevProposalDiscardResult =
  | { managed: false }
  | { managed: true; ok: true }
  | { managed: true; ok: false; error: string };

type CodevProposalCreateResult =
  | { ok: true; worktreeId: string }
  | { ok: false; error: string; status?: number; code?: string };

const WORKTREE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isSafeWorkspaceBranchRoute(value: string): boolean {
  if (!value || value.length > 255) {
    return false;
  }
  return !Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

/** Build the browser URL after the embedded client selects a branch. */
export function replaceWorkspaceBranchRoute(
  currentUrl: URL,
  branch: string | null,
): string {
  const next = new URL(currentUrl.toString());
  const normalized = branch?.trim() ?? "";
  if (normalized && isSafeWorkspaceBranchRoute(normalized)) {
    next.searchParams.set("branch", normalized);
  } else {
    next.searchParams.delete("branch");
  }
  next.searchParams.delete("agent");
  return `${next.pathname}${next.search}${next.hash}`;
}

/** Build the browser URL after the embedded client opens an agent detail. */
export function replaceWorkspaceAgentRoute(
  currentUrl: URL,
  branch: string | null,
  agent: string | null,
): string {
  const next = new URL(currentUrl.toString());
  const normalizedBranch = branch?.trim() ?? "";
  const normalizedAgent = agent?.trim() ?? "";
  if (normalizedBranch && isSafeWorkspaceBranchRoute(normalizedBranch)) {
    next.searchParams.set("branch", normalizedBranch);
  } else if (!normalizedBranch) {
    next.searchParams.delete("branch");
  }
  if (normalizedAgent && isSafeWorkspaceBranchRoute(normalizedAgent)) {
    next.searchParams.set("agent", normalizedAgent);
  } else {
    next.searchParams.delete("agent");
  }
  return `${next.pathname}${next.search}${next.hash}`;
}

/** A non-negative whole number arriving over `postMessage`, where anything is
 *  possible. */
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export async function discardOrcaManagedProposal(
  workspaceId: string,
  worktreeId: string,
  fetcher: typeof fetch = fetch,
): Promise<CodevProposalDiscardResult> {
  if (!WORKTREE_ID.test(worktreeId)) {
    return { managed: false };
  }
  try {
    const sessionsResponse = await fetcher(
      `/api/workspaces/${workspaceId}/agents`,
      { cache: "no-store" },
    );
    const sessionsPayload = (await sessionsResponse
      .json()
      .catch(() => null)) as unknown;
    if (!sessionsResponse.ok) {
      throw new Error("CoDev could not inspect managed proposals.");
    }
    const sessions =
      sessionsPayload &&
      typeof sessionsPayload === "object" &&
      "sessions" in sessionsPayload &&
      Array.isArray(sessionsPayload.sessions)
        ? sessionsPayload.sessions
        : [];
    const session = sessions.find(
      (candidate): candidate is { id: string; worktreeId: string } =>
        candidate !== null &&
        typeof candidate === "object" &&
        "id" in candidate &&
        typeof candidate.id === "string" &&
        "worktreeId" in candidate &&
        candidate.worktreeId === worktreeId,
    );
    if (!session) {
      return { managed: false };
    }

    const discardResponse = await fetcher(
      `/api/workspaces/${workspaceId}/agents/${session.id}/discard`,
      { method: "POST" },
    );
    const discardPayload = (await discardResponse.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    if (!discardResponse.ok) {
      return {
        managed: true,
        ok: false,
        error:
          typeof discardPayload?.error === "string"
            ? discardPayload.error
            : "CoDev could not discard this proposal.",
      };
    }
    return { managed: true, ok: true };
  } catch (error) {
    return {
      managed: true,
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "CoDev could not discard this proposal.",
    };
  }
}

export async function createOrcaManagedProposal(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<CodevProposalCreateResult> {
  try {
    const response = await fetcher(`/api/workspaces/${workspaceId}/agents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Managed proposal",
        draft: true,
        attachments: [],
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: unknown;
      worktreeId?: unknown;
      code?: unknown;
    } | null;
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error:
          typeof payload?.error === "string"
            ? payload.error
            : "CoDev could not prepare this proposal.",
        ...(typeof payload?.code === "string" ? { code: payload.code } : {}),
      };
    }
    const worktreeId =
      typeof payload?.worktreeId === "string" ? payload.worktreeId : "";
    if (!WORKTREE_ID.test(worktreeId)) {
      return {
        ok: false,
        error: "CoDev did not return a managed proposal worktree.",
      };
    }
    return { ok: true, worktreeId };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "CoDev could not prepare this proposal.",
    };
  }
}

/** Agent the embedded IDE opens the workspace's default chat tab with. */
export type OrcaDefaultAgent = "claude" | "codex";

export function buildOrcaIframeSource({
  webClientPath,
  pairingCode,
  workspacePath,
  projectKind,
  projectName,
  defaultAgent,
  memberId,
  settingsOnly,
  cursorAvailable,
  branch,
  agent,
}: {
  webClientPath: string;
  pairingCode: string;
  workspacePath: string;
  projectKind: "git" | "folder";
  projectName?: string;
  /** Pins which agent the workspace's default chat tab launches with. */
  defaultAgent?: OrcaDefaultAgent;
  /**
   * The signed-in member, so agents launched in this iframe run on their own
   * linked subscription rather than the one belonging to whichever member
   * started the shared session. An id, never a credential.
   */
  memberId?: string;
  /** Render the personal settings surface instead of the workspace IDE. */
  settingsOnly?: boolean;
  /** Whether this member has a linked Cursor credential — gates offering it
   *  in the IDE's in-chat provider switcher. */
  cursorAvailable?: boolean;
  /** Optional raw branch name to select after the embedded workspace loads. */
  branch?: string;
  /** Optional managed agent session to open in the selected branch. */
  agent?: string;
}) {
  const fragment = new URLSearchParams({
    pairing: pairingCode,
    codev: "1",
    codevProject: workspacePath,
    codevProjectKind: projectKind,
  });
  if (projectName) {
    fragment.set("codevProjectName", projectName);
  }
  if (defaultAgent) {
    fragment.set("codevDefaultAgent", defaultAgent);
  }
  if (memberId) {
    fragment.set("codevMemberId", memberId);
  }
  if (settingsOnly) {
    fragment.set("codevSettingsOnly", "1");
  }
  if (cursorAvailable) {
    fragment.set("codevCursorAvailable", "1");
  }
  if (branch) {
    fragment.set("codevBranch", branch);
  }
  if (agent) {
    fragment.set("codevAgent", agent);
  }
  return `${webClientPath}#${fragment.toString()}`;
}

/**
 * The iframe src used before the host is up: everything the client can know
 * from this origin, and `codevPending=1` so it renders the IDE shell now and
 * waits for the pairing + project path to arrive over `codev:pair`.
 */
export function buildOrcaPendingIframeSource({
  projectKind,
  projectName,
  defaultAgent,
  cursorAvailable,
  branch,
  agent,
}: {
  projectKind: "git" | "folder";
  projectName?: string;
  defaultAgent?: OrcaDefaultAgent;
  cursorAvailable?: boolean;
  branch?: string;
  agent?: string;
}) {
  const fragment = new URLSearchParams({
    codev: "1",
    codevPending: "1",
    codevProjectKind: projectKind,
  });
  if (projectName) {
    fragment.set("codevProjectName", projectName);
  }
  if (defaultAgent) {
    fragment.set("codevDefaultAgent", defaultAgent);
  }
  if (cursorAvailable) {
    fragment.set("codevCursorAvailable", "1");
  }
  if (branch) {
    fragment.set("codevBranch", branch);
  }
  if (agent) {
    fragment.set("codevAgent", agent);
  }
  return `${ORCA_WEB_CLIENT_PATH}#${fragment.toString()}`;
}

/**
 * Adds CoDev-owned branding to the small number of visible Orca surfaces that
 * identify the host product. The iframe remains an unmodified upstream bundle;
 * this is applied after it has loaded from the same CoDev origin.
 */
export function applyOrcaWorkspaceBranding(
  doc: Document,
  workspaceName: string,
) {
  const emptyStateLogo = doc.querySelector<HTMLImageElement>(
    'img[alt="CoDev logo"]',
  );
  if (emptyStateLogo) {
    if (emptyStateLogo.getAttribute("src") !== CODEV_EMPTY_STATE_LOGO_SRC) {
      emptyStateLogo.src = CODEV_EMPTY_STATE_LOGO_SRC;
    }
    emptyStateLogo.classList.add("codev-orca-empty-logo");
  }

  const titlebars = doc.querySelectorAll<HTMLElement>(
    ".titlebar-app-name-main",
  );
  titlebars.forEach((title) => {
    if (title.dataset.codevWorkspaceName !== workspaceName) {
      title.dataset.codevWorkspaceName = workspaceName;
    }
  });

  return Boolean(emptyStateLogo) && titlebars.length > 0;
}

function injectOrcaThemeAndBranding(
  iframe: HTMLIFrameElement,
  workspaceName: string,
) {
  try {
    const doc = iframe.contentDocument;
    if (!doc?.head) {
      return () => undefined;
    }

    if (!doc.getElementById("codev-orca-theme")) {
      const link = doc.createElement("link");
      link.id = "codev-orca-theme";
      link.rel = "stylesheet";
      link.href = ORCA_THEME_OVERRIDE_HREF;
      doc.head.appendChild(link);
    }

    const stopHidingProjectTree = watchOrcaProjectTree(doc);

    if (applyOrcaWorkspaceBranding(doc, workspaceName)) {
      return stopHidingProjectTree;
    }
    if (!doc.body) {
      return stopHidingProjectTree;
    }

    const observer = new MutationObserver(() => {
      if (applyOrcaWorkspaceBranding(doc, workspaceName)) {
        stopWatchingBranding();
      }
    });
    observer.observe(doc.body, { childList: true, subtree: true });
    const timeout = setTimeout(stopWatchingBranding, 10_000);

    function stopWatchingBranding() {
      observer.disconnect();
      clearTimeout(timeout);
    }

    return () => {
      stopWatchingBranding();
      stopHidingProjectTree();
    };
  } catch {
    // Same-origin injection is best-effort; stock Orca colors are fine as fallback.
    return () => undefined;
  }
}

/**
 * How the top bar names what the embedded IDE reported. "Live" was the word
 * that broke this: Mission Control's list deliberately includes chat tabs
 * sitting idle between turns, so a bar that called every row live claimed
 * "1 agent live" next to a card reading "Idle". Working and idle are counted
 * as the different things they are, and a workspace with neither says so.
 */
export function agentActivityText(
  agents: { active: number; idle: number } | null,
): string | null {
  if (agents == null) return null;
  const { active, idle } = agents;
  const working = active === 1 ? "1 agent working" : `${active} agents working`;
  if (active > 0) return idle > 0 ? `${working} · ${idle} idle` : working;
  if (idle > 0) return idle === 1 ? "1 agent idle" : `${idle} agents idle`;
  return "No agents running";
}

function creditMinutesText(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function creditUsdText(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function computeCreditText(
  creditStatus: WorkspaceCreditStatus | null | undefined,
  isAdmin: boolean,
) {
  if (isAdmin) {
    return {
      label: "Compute · No limit",
      ariaLabel:
        "Compute credit: no limit for administrators; runtime is still tracked in the admin console",
    };
  }
  if (!creditStatus) return null;
  return {
    label: `Compute · ${creditUsdText(creditStatus.remainingUsd)}/${creditUsdText(creditStatus.allottedUsd)}`,
    ariaLabel: `Compute credit: ${creditUsdText(creditStatus.remainingUsd)} remaining of ${creditUsdText(creditStatus.allottedUsd)} pooled across ${creditStatus.memberCount} member${creditStatus.memberCount === 1 ? "" : "s"}; ${creditMinutesText(creditStatus.remainingMinutes)} remaining; resets at the start of next month`,
  };
}

export function WorkspaceTopBar({
  repository,
  workspaceId,
  canInvite,
  creditStatus = null,
  agents = null,
  isAdmin = false,
  slotsUsed = null,
  slotsTotal = MAX_PARALLEL_AGENT_SESSIONS,
  isStarting = false,
}: {
  repository: string | null;
  workspaceId: string;
  canInvite: boolean;
  /** Current pooled member allowance; admins receive an unlimited label. */
  creditStatus?: WorkspaceCreditStatus | null;
  /** Application-wide administrators bypass the pooled compute gate. */
  isAdmin?: boolean;
  /** What the embedded Mission Control reports: agents working now, and agent
   *  sessions open but idle. `null` until it has reported at all. */
  agents?: { active: number; idle: number } | null;
  /** Worktree slots in use. Not the same number: several agents share one
   *  checkout, and a chat in the workspace's own checkout holds no slot. The
   *  bar used to print the agent count over the slot denominator. */
  slotsUsed?: number | null;
  slotsTotal?: number;
  isStarting?: boolean;
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const agentsText = agentActivityText(agents);
  const slotsText =
    slotsUsed == null ? null : `${slotsUsed} of ${slotsTotal} slots`;
  const liveLabel = isStarting
    ? "Starting workspace…"
    : agentsText == null
      ? `${slotsTotal} agent worktree slots`
      : slotsText
        ? `${agentsText} · ${slotsText}`
        : agentsText;
  const liveAriaLabel = isStarting
    ? "Workspace is starting"
    : agentsText == null
      ? `Agent worktree capacity: ${slotsTotal} slots`
      : `${agentsText}${slotsText ? `; worktree slots: ${slotsUsed} of ${slotsTotal} in use` : ""}`;
  const computeCredit = computeCreditText(creditStatus, isAdmin);

  return (
    <header className="workspace-topbar">
      <Link href="/dashboard" className="workspace-topbar-home">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M9.5 3 5 8l4.5 5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        CoDev
      </Link>
      {repository ? (
        <span className="workspace-topbar-repo">{repository}</span>
      ) : null}
      <div className="workspace-topbar-actions">
        {computeCredit ? (
          <span
            className={`workspace-topbar-credit${isAdmin ? " is-unlimited" : ""}`}
            role="status"
            aria-label={computeCredit.ariaLabel}
            title={computeCredit.ariaLabel}
          >
            {computeCredit.label}
          </span>
        ) : null}
        <span
          className={`workspace-topbar-capacity${!isStarting && agents && agents.active > 0 ? " is-live" : ""}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={liveAriaLabel}
        >
          {liveLabel}
        </span>
        <Link
          className="workspace-topbar-share"
          href={`/workspaces/${workspaceId}/activity`}
        >
          <History aria-hidden size={13} />
          Activity
        </Link>
        <button
          className="workspace-topbar-share"
          type="button"
          onClick={() => setShareOpen(true)}
        >
          <Share2 aria-hidden size={13} />
          Share
        </button>
      </div>
      <WorkspaceShareDialog
        canInvite={canInvite}
        onClose={() => setShareOpen(false)}
        open={shareOpen}
        workspaceId={workspaceId}
      />
    </header>
  );
}

function WorkspaceChrome({
  repository,
  workspaceId,
  canInvite,
  creditStatus = null,
  isAdmin = false,
  embeddedAgents = null,
  embeddedSlots = null,
  isStarting = false,
  children,
}: {
  repository: string | null;
  workspaceId: string;
  canInvite: boolean;
  creditStatus?: WorkspaceCreditStatus | null;
  isAdmin?: boolean;
  /** The embedded Mission Control's merged report, when the IDE has sent one.
   *  It sees this client's own chat-tab agents, which the server-side
   *  workboard never registers, so it is the only source that can count
   *  agents at all — see the fallback note below. */
  embeddedAgents?: { active: number; idle: number } | null;
  /** Worktree slots in use, as the embedded IDE read them off the workboard. */
  embeddedSlots?: { used: number; total: number } | null;
  isStarting?: boolean;
  children: ReactNode;
}) {
  const activity = useLiveAgentActivity(workspaceId);

  return (
    <div className="workspace-page">
      <WorkspaceTopBar
        canInvite={canInvite}
        creditStatus={creditStatus}
        // Only the IDE can count agents. The workboard's `occupied` is
        // `capacity.activeSessions` — worktree slots held by managed sessions
        // — so the old fallback printed a slot count as an agent count, and
        // then printed the very same number again as the slot count.
        agents={embeddedAgents}
        slotsUsed={embeddedSlots?.used ?? activity?.occupied ?? null}
        slotsTotal={embeddedSlots?.total ?? MAX_PARALLEL_AGENT_SESSIONS}
        isStarting={isStarting}
        isAdmin={isAdmin}
        repository={repository}
        workspaceId={workspaceId}
      />
      {/* The workspace's team rail (people, status, channels) and its live
          agents both live inside the embedded IDE's own sidebars now — the
          team rail folded into Orca's left sidebar, live agents in its right
          one — so the parent page is just the top bar plus the IDE. The live
          count stays in the top bar so it is visible from here too. */}
      <div className="workspace-body">{children}</div>
    </div>
  );
}

/**
 * Full-viewport host for the vendored Orca web client. Fetches the runtime
 * pairing offer from the CoDev backend, then boots the unmodified Orca web
 * bundle in an iframe via its `#pairing=` startup fragment.
 */
export function OrcaWorkspace({
  workspaceId,
  repository,
  canInvite,
  creditStatus = null,
  isAdmin = false,
  defaultAgent,
  cursorAvailable,
  initialBranch,
  initialAgent,
  providerPreflight,
}: {
  workspaceId: string;
  repository: string | null;
  canInvite: boolean;
  /** Current pooled member allowance; admins receive an unlimited label. */
  creditStatus?: WorkspaceCreditStatus | null;
  /** Application-wide administrators bypass the pooled compute gate. */
  isAdmin?: boolean;
  defaultAgent?: OrcaDefaultAgent;
  /** Whether this member has a linked Cursor credential — gates offering it
   *  in the IDE's in-chat provider switcher. */
  cursorAvailable?: boolean;
  /** Optional branch route selected by the workspace page. */
  initialBranch?: string;
  /** Optional managed agent route selected by the workspace page. */
  initialAgent?: string;
  /** Which agent is about to run, and any the member must still connect for
   *  workspaces — shown on the startup screen, and kept up when actionable. */
  providerPreflight?: WorkspaceProviderPreflight;
}) {
  const [connection, setConnection] = useState<ConnectionPhase>({
    phase: "connecting",
  });
  const [attempt, setAttempt] = useState(0);
  const [isOpeningProject, setIsOpeningProject] = useState(false);
  const [isSlowStart, setIsSlowStart] = useState(false);
  // Seeded on the first effect run rather than during render: `Date.now()` is
  // impure, and the value only ever feeds the "this is taking a while" copy.
  const waitingSinceRef = useRef<number | null>(null);
  const [repositoryDialogOpen, setRepositoryDialogOpen] = useState(false);
  // The embedded IDE reports its chrome has painted; until then the loading
  // skeleton covers the iframe. `iframeKey` forces a fresh iframe load when a
  // reaped session has to be replaced under an open tab.
  const [shellReady, setShellReady] = useState(false);
  const [embeddedAgents, setEmbeddedAgents] = useState<{
    active: number;
    idle: number;
  } | null>(null);
  const [embeddedSlots, setEmbeddedSlots] = useState<{
    used: number;
    total: number;
  } | null>(null);
  // The connect poll's last genuine failure and how many in a row. A 202
  // ("still starting") is not a failure and clears it.
  const [connectFailure, setConnectFailure] = useState<{
    message: string;
    attempts: number;
  } | null>(null);
  const connectFailureRef = useRef(connectFailure);
  // The embed can ask for a fresh connect poll; `retry` is defined below.
  const retryRef = useRef<() => void>(() => undefined);
  // The page supplies the initial snapshot; only a post-connect refresh needs
  // local state. Keeping the prop as the base avoids an effect that mirrors
  // props into state and briefly renders stale readiness after navigation.
  const [refreshedPreflight, setRefreshedPreflight] =
    useState<WorkspaceProviderPreflight | null>(null);
  const livePreflight = refreshedPreflight ?? providerPreflight;
  const [iframeKey, setIframeKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const disposeIframeBranding = useRef<(() => void) | null>(null);
  // Held here (not in `connection`) so it survives the poll's state churn and
  // can be (re)delivered to the iframe on its next load.
  const pendingPairRef = useRef<PendingPair | null>(null);
  const codevBridgeSessionRef = useRef<CodevParentBridgeSession>(
    EMPTY_CODEV_PARENT_BRIDGE_SESSION,
  );

  // The iframe src never changes across a connect: it boots from the static
  // bundle immediately with `codevPending=1`, and the pairing arrives later
  // over `codev:pair`. Rebuilt only when the RSC-known project facts change.
  const pendingIframeSrc = useMemo(
    () =>
      buildOrcaPendingIframeSource({
        projectKind: repository ? "git" : "folder",
        ...(repository ? { projectName: repository } : {}),
        ...(defaultAgent ? { defaultAgent } : {}),
        ...(cursorAvailable ? { cursorAvailable } : {}),
        ...(initialBranch ? { branch: initialBranch } : {}),
        ...(initialAgent ? { agent: initialAgent } : {}),
      }),
    [repository, defaultAgent, cursorAvailable, initialAgent, initialBranch],
  );

  // Hand the pairing to the embedded IDE. Safe to call repeatedly and before
  // the pairing exists — it no-ops until both the pairing and a live iframe
  // window are in hand, so callers fire it from the poll and from `onLoad`.
  const deliverPairing = useCallback(() => {
    const pair = pendingPairRef.current;
    const target = iframeRef.current?.contentWindow;
    if (!pair || !target) {
      return;
    }
    target.postMessage(
      {
        type: "codev:pair",
        pairing: pair.pairingCode,
        projectPath: pair.workspacePath,
        projectKind: repository ? "git" : "folder",
        ...(repository ? { projectName: repository } : {}),
        ...(defaultAgent ? { defaultAgent } : {}),
        ...(pair.memberId ? { memberId: pair.memberId } : {}),
        ...(cursorAvailable ? { cursorAvailable } : {}),
      },
      window.location.origin,
    );
  }, [repository, defaultAgent, cursorAvailable]);

  // Tell the embedded IDE whether the machine is still waking. Without this it
  // has only a stopwatch, and cannot tell a normal cold boot (up to a minute of
  // EC2 start, orchestrator, microVM, clone) from a handoff that is stuck — so
  // it used to accuse the workspace of being slow while it was merely starting.
  // Read by the `message` listener, which must not re-register on every phase
  // change (re-registering mid-handshake drops messages).
  const connectionPhaseRef = useRef(connection.phase);
  const slowStartRef = useRef(isSlowStart);
  useEffect(() => {
    connectionPhaseRef.current = connection.phase;
    slowStartRef.current = isSlowStart;
    connectFailureRef.current = connectFailure;
  }, [connection.phase, isSlowStart, connectFailure]);

  const reportHostState = useCallback(
    (phase: "starting" | "ready", slow: boolean) => {
      iframeRef.current?.contentWindow?.postMessage(
        {
          type: "codev:host-state",
          phase,
          slow,
          failure: phase === "starting" ? connectFailureRef.current : null,
        },
        window.location.origin,
      );
    },
    [],
  );

  // Whether an agent can actually run here, which only this page can know.
  // Sent rather than merely rendered in the banner: without it the embedded
  // IDE opened a chat tab and took messages for an agent that could not reply.
  const readiness = useMemo(
    () => (livePreflight ? workspaceProviderReadiness(livePreflight) : null),
    [livePreflight],
  );
  const reportProviderReadiness = useCallback(() => {
    if (!readiness) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: "codev:provider-readiness", ...readiness },
      window.location.origin,
    );
  }, [readiness]);
  const refreshProviderPreflight = useCallback(() => {
    void refreshWorkspaceProviderPreflight().then((next) => {
      if (next) setRefreshedPreflight(next);
    });
  }, []);

  // Time-to-shell / time-to-project, measured from this component's first
  // paint (which is when the iframe starts loading the static bundle).
  const bootStartRef = useRef<number | null>(null);
  const reportedRef = useRef({ shell: false, project: false });
  useEffect(() => {
    bootStartRef.current ??= performance.now();
    return () => {
      disposeIframeBranding.current?.();
    };
  }, []);
  const reportBootMark = useCallback(
    (event: "workspace_shell_ready" | "workspace_project_ready") => {
      const key = event === "workspace_shell_ready" ? "shell" : "project";
      if (reportedRef.current[key] || bootStartRef.current === null) {
        return;
      }
      reportedRef.current[key] = true;
      track(event, {
        ms: Math.round(performance.now() - bootStartRef.current),
      });
    },
    [],
  );

  useEffect(() => {
    function receiveOrcaMessage(event: MessageEvent<CodevOrcaMessage>) {
      if (
        event.origin !== window.location.origin ||
        event.source !== iframeRef.current?.contentWindow ||
        !event.data ||
        typeof event.data !== "object"
      ) {
        return;
      }
      if (isCodevBridgeClientMessage(event.data)) {
        const { session, reply } = replyToCodevBridgeMessage(
          codevBridgeSessionRef.current,
          event.data,
        );
        codevBridgeSessionRef.current = session;
        if (reply) {
          iframeRef.current?.contentWindow?.postMessage(
            reply,
            window.location.origin,
          );
        }
        return;
      }
      if (isCodevBridgeRequestMessage(event.data)) {
        void executeCodevBridgeRequest(
          workspaceId,
          event.data,
          codevBridgeSessionRef.current,
        ).then((reply) => {
          iframeRef.current?.contentWindow?.postMessage(
            reply,
            window.location.origin,
          );
        });
        return;
      }
      if (event.data.type === "codev:choose-repository") {
        setRepositoryDialogOpen(true);
      } else if (
        event.data.type === "codev:discard-proposal" &&
        typeof event.data.requestId === "string" &&
        typeof event.data.worktreeId === "string"
      ) {
        const { requestId, worktreeId } = event.data;
        void discardOrcaManagedProposal(workspaceId, worktreeId).then(
          (result) => {
            iframeRef.current?.contentWindow?.postMessage(
              {
                type: "codev:proposal-discard-result",
                requestId,
                ...result,
              },
              window.location.origin,
            );
          },
        );
      } else if (
        event.data.type === "codev:create-proposal" &&
        typeof event.data.requestId === "string"
      ) {
        const { requestId } = event.data;
        void createOrcaManagedProposal(workspaceId).then((result) => {
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: "codev:proposal-create-result",
              requestId,
              ...result,
            },
            window.location.origin,
          );
        });
      } else if (event.data.type === "codev:shell-ready") {
        // It is listening now, so it may have missed every earlier report.
        reportHostState(
          connectionPhaseRef.current === "ready" ? "ready" : "starting",
          slowStartRef.current,
        );
        setShellReady(true);
        reportBootMark("workspace_shell_ready");
        // Same reasoning as the pairing below: a report sent before the shell
        // attached its listener was dropped silently.
        reportProviderReadiness();
        // The pairing can already be sitting in pendingPairRef by the time the
        // shell announces itself (a warm host resolves the wake-poll almost
        // instantly, well before the iframe has loaded its bundle, mounted
        // React, and attached its own `message` listener) — a postMessage
        // sent before that listener exists is simply dropped, no error, no
        // retry, and the shell waits for a pairing that already came and went.
        // This is the one signal that proves the listener is actually up, so
        // deliver (or re-deliver) here regardless of what triggered delivery
        // before.
        deliverPairing();
      } else if (event.data.type === "codev:project-ready") {
        setIsOpeningProject(false);
        reportBootMark("workspace_project_ready");
      } else if (event.data.type === "codev:agent-count") {
        // The embedded Mission Control merges managed sessions with this
        // client's own chat-tab agents; the workboard the top bar polls only
        // knows the managed half. Prefer the merged figure so the two never
        // contradict each other.
        //
        // It reports the split because its list includes open-but-idle chat
        // tabs. An older bundle sends only `count` (the total); treat that as
        // all-idle rather than all-live — understating activity is the safe
        // direction, and the bar re-reads the truth on the next report.
        const { active, idle, count } = event.data;
        if (typeof active === "number" && typeof idle === "number") {
          if (isCount(active) && isCount(idle)) {
            setEmbeddedAgents({ active, idle });
          }
        } else if (isCount(count)) {
          setEmbeddedAgents({ active: 0, idle: count });
        }
        const { slotsUsed, slotsTotal } = event.data;
        if (
          typeof slotsUsed === "number" &&
          typeof slotsTotal === "number" &&
          Number.isFinite(slotsUsed) &&
          Number.isFinite(slotsTotal) &&
          slotsTotal > 0 &&
          slotsUsed >= 0
        ) {
          setEmbeddedSlots({ used: slotsUsed, total: slotsTotal });
        }
      } else if (event.data.type === "codev:retry-connect") {
        // The embedded cover offers "Retry now" when this page reports the
        // runtime as unreachable; the poll is ours to restart.
        retryRef.current();
      } else if (event.data.type === "codev:branch-route") {
        const branch = event.data.branch?.trim() ?? "";
        if (branch && !isSafeWorkspaceBranchRoute(branch)) {
          return;
        }
        window.history.replaceState(
          window.history.state,
          "",
          replaceWorkspaceBranchRoute(
            new URL(window.location.href),
            branch || null,
          ),
        );
      } else if (event.data.type === "codev:agent-route") {
        const branch = event.data.branch?.trim() ?? "";
        const agent = event.data.agent?.trim() ?? "";
        if (
          (branch && !isSafeWorkspaceBranchRoute(branch)) ||
          (agent && !isSafeWorkspaceBranchRoute(agent))
        ) {
          return;
        }
        window.history.replaceState(
          window.history.state,
          "",
          replaceWorkspaceAgentRoute(
            new URL(window.location.href),
            branch || null,
            agent || null,
          ),
        );
      } else if (event.data.type === "codev:provider-readiness-refresh") {
        refreshProviderPreflight();
      } else if (event.data.type === "codev:startup-failure") {
        // The embedded IDE has no telemetry channel of its own, so its startup
        // faults reach the outside world only through here.
        track("workspace_hydration_failed", {
          step: event.data.step ?? "unknown",
          message: (event.data.message ?? "").slice(0, 200),
        });
      } else if (event.data.type === "codev:project-error") {
        setIsOpeningProject(false);
        setConnection({
          phase: "error",
          message:
            event.data.message || "The workspace project could not be opened.",
        });
      }
    }

    window.addEventListener("message", receiveOrcaMessage);
    return () => window.removeEventListener("message", receiveOrcaMessage);
  }, [
    workspaceId,
    reportBootMark,
    deliverPairing,
    reportHostState,
    reportProviderReadiness,
    refreshProviderPreflight,
  ]);

  // Fallback reveal: if the iframe never sends `codev:shell-ready` (older
  // bundle, or a shell that failed to paint), stop covering it once the wait
  // has clearly outlasted a normal boot — by then it is the real IDE anyway.
  useEffect(() => {
    if (shellReady) {
      return;
    }
    const timer = setTimeout(
      () => setShellReady(true),
      SHELL_READY_FALLBACK_MS,
    );
    return () => clearTimeout(timer);
  }, [shellReady, iframeKey]);

  useEffect(() => {
    const phase = connection.phase === "ready" ? "ready" : "starting";
    reportHostState(phase, isSlowStart);
    if (phase === "ready") {
      return;
    }
    // The shell may mount after the first report; repeat until it is up.
    const timer = setInterval(
      () => reportHostState(phase, isSlowStart),
      HOST_STATE_REPORT_MS,
    );
    return () => clearInterval(timer);
  }, [
    connection.phase,
    isSlowStart,
    connectFailure,
    reportHostState,
    iframeKey,
  ]);

  // Re-report readiness when it changes (the member connected a provider in
  // another tab and came back) or when the iframe is replaced under us.
  useEffect(() => {
    reportProviderReadiness();
  }, [reportProviderReadiness, shellReady, iframeKey]);

  // Re-hand the pairing whenever we newly have one (the poll may resolve after
  // the iframe has already loaded, so `onLoad` alone is not enough).
  useEffect(() => {
    if (connection.phase === "ready") {
      deliverPairing();
    }
  }, [connection.phase, deliverPairing]);

  const retry = useCallback(() => {
    waitingSinceRef.current = null;
    setIsSlowStart(false);
    setShellReady(false);
    // The counts described the IDE that is being torn down. Leaving them up
    // meant a re-provisioned workspace showed the dead session's agents until
    // the fresh embed happened to report.
    setEmbeddedAgents(null);
    setEmbeddedSlots(null);
    pendingPairRef.current = null;
    connectFailureRef.current = null;
    setConnectFailure(null);
    setIsOpeningProject(false);
    setIframeKey((current) => current + 1);
    setConnection({ phase: "connecting" });
    setAttempt((current) => current + 1);
  }, []);
  useEffect(() => {
    retryRef.current = retry;
  }, [retry]);

  /**
   * Hold the IDE session open while this tab is actually being looked at.
   * The Orca client connects straight to the host, so without this the
   * orchestrator sees a session in constant use as completely idle and reaps
   * it - and then powers the host down - mid-session.
   */
  useEffect(() => {
    if (connection.phase !== "ready") {
      return;
    }
    let cancelled = false;
    async function sendKeepalive() {
      if (cancelled || document.visibilityState !== "visible") {
        return;
      }
      try {
        const response = await fetch(
          `/api/workspaces/${workspaceId}/orca/activity`,
          { method: "POST", keepalive: true },
        );
        const payload = (await response.json().catch(() => null)) as {
          session?: string;
        } | null;
        // The session this iframe is bound to no longer exists - the host was
        // stopped or replaced under an open tab, or the session was reaped.
        // The embedded IDE is dead and will not recover on its own, so go
        // back through the connect path and get a fresh one rather than
        // leaving somebody staring at a blank pane.
        if (!cancelled && payload?.session === "gone") {
          setIsOpeningProject(false);
          setShellReady(false);
          setEmbeddedAgents(null);
          setEmbeddedSlots(null);
          pendingPairRef.current = null;
          setIframeKey((current) => current + 1);
          setConnection({ phase: "connecting" });
          setAttempt((current) => current + 1);
        }
      } catch {
        // Transient: the next keepalive covers it.
      }
    }
    void sendKeepalive();
    const onTick = () => void sendKeepalive();
    const timer = setInterval(onTick, IDE_KEEPALIVE_MS);
    document.addEventListener("visibilitychange", onTick);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onTick);
    };
  }, [connection.phase, workspaceId]);

  useEffect(() => {
    if (connection.phase === "ready" || connection.phase === "error") {
      return;
    }
    waitingSinceRef.current ??= Date.now();
    const timer = setInterval(() => {
      const since = waitingSinceRef.current;
      setIsSlowStart(
        since !== null && Date.now() - since >= SLOW_START_NOTICE_MS,
      );
    }, 5_000);
    return () => clearInterval(timer);
  }, [connection.phase]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * Everything that is not the person's own problem - a stopped host, a
     * capacity refusal, an orchestrator still booting, a dropped request -
     * keeps polling behind the ordinary starting state. Only the statuses
     * they can actually act on (sign in, ask for access, missing workspace,
     * quota) become an error screen.
     */
    /**
     * `failure` names a genuine failure (a 5xx, a malformed answer, a dropped
     * or timed-out request); a plain "still starting" answer passes nothing
     * and clears any earlier failure. Failures are counted so the waiting
     * copy can name them, and after long enough with nothing else they stop
     * being a wait at all.
     */
    function waitAndRetry(failure?: string) {
      if (failure) {
        const attempts = (connectFailureRef.current?.attempts ?? 0) + 1;
        const since = waitingSinceRef.current;
        if (
          attempts >= CONNECT_FAILURE_NOTICE_ATTEMPTS &&
          since !== null &&
          Date.now() - since >= CONNECT_FAILURE_ESCALATE_MS
        ) {
          setConnection({
            phase: "error",
            message: `The workspace runtime could not be reached after ${attempts} attempts. Last failure: ${failure}.`,
          });
          return;
        }
        const next = { message: failure, attempts };
        connectFailureRef.current = next;
        setConnectFailure(next);
      } else if (connectFailureRef.current) {
        connectFailureRef.current = null;
        setConnectFailure(null);
      }
      setConnection({ phase: "host-starting" });
      retryTimer = setTimeout(() => {
        setAttempt((current) => current + 1);
      }, HOST_STARTING_RETRY_MS);
    }

    let controller: AbortController | null = null;

    async function connect() {
      controller = new AbortController();
      const requestTimer = setTimeout(
        () => controller?.abort(),
        CONNECT_REQUEST_TIMEOUT_MS,
      );
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/orca`, {
          method: "POST",
          signal: controller.signal,
        });
        const payload = (await response
          .json()
          .catch(() => null)) as OrcaConnectResponse | null;
        if (cancelled) {
          return;
        }
        if (response.status === 202) {
          waitAndRetry();
          return;
        }
        // The runtime is not reachable from this environment at all. Polling
        // is what turned this into "still starting… it will open on its own"
        // forever, so stop and say what is wrong — it is usually missing
        // configuration, and nothing here will change without a person.
        if (payload?.state === "unavailable") {
          setConnection({
            phase: "error",
            message:
              payload.error || "This workspace's runtime is not reachable.",
          });
          return;
        }
        if (isActionableOrcaConnectStatus(response.status)) {
          setConnection({
            phase: "error",
            message:
              payload?.error || "The workspace runtime could not be reached.",
          });
          return;
        }
        if (!response.ok) {
          waitAndRetry(
            `the runtime answered ${response.status}${payload?.error ? ` (${payload.error})` : ""}`,
          );
          return;
        }
        if (!payload?.pairingCode || !payload.webClientPath) {
          waitAndRetry("the runtime answered without a pairing offer");
          return;
        }
        const workspacePath = payload.workspacePath;
        if (!workspacePath) {
          waitAndRetry("the runtime answered without a workspace path");
          return;
        }
        connectFailureRef.current = null;
        setConnectFailure(null);
        // The iframe is already running the pending shell — hand it the
        // pairing rather than reloading it. `deliverPairing` fires from the
        // effect keyed on this phase change (and again from `onLoad`).
        pendingPairRef.current = {
          pairingCode: payload.pairingCode,
          workspacePath,
          ...(payload.memberId ? { memberId: payload.memberId } : {}),
        };
        setIsOpeningProject(true);
        setConnection({ phase: "ready" });
      } catch (error) {
        if (!cancelled) {
          waitAndRetry(
            controller?.signal.aborted
              ? `no answer within ${CONNECT_REQUEST_TIMEOUT_MS / 1000}s`
              : error instanceof Error && error.message
                ? `the request failed (${error.message})`
                : "the request failed",
          );
        }
      } finally {
        clearTimeout(requestTimer);
      }
    }

    void connect();
    return () => {
      cancelled = true;
      controller?.abort();
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [workspaceId, repository, attempt, defaultAgent, cursorAvailable]);

  if (connection.phase === "error") {
    return (
      <WorkspaceChrome
        canInvite={canInvite}
        creditStatus={creditStatus}
        isAdmin={isAdmin}
        repository={repository}
        workspaceId={workspaceId}
      >
        <main className="workspace-status">
          <h1>Could not open the workspace</h1>
          <p>{connection.message}</p>
          <button
            type="button"
            className="workspace-status-retry"
            onClick={retry}
          >
            Retry
          </button>
        </main>
      </WorkspaceChrome>
    );
  }

  // The iframe boots from the static bundle the moment this component mounts,
  // so the IDE chrome paints while the host is still waking. An IDE-shaped
  // skeleton covers it until `codev:shell-ready`; after that a small pill in
  // the corner reports host-wake / project-open progress non-blockingly.
  const hostReady = connection.phase === "ready";
  // Only a persistent failure is worth naming; one dropped request is noise.
  const failureNotice =
    connectFailure && connectFailure.attempts >= CONNECT_FAILURE_NOTICE_ATTEMPTS
      ? `Still can’t reach the workspace — ${connectFailure.message} (attempt ${connectFailure.attempts}). Retrying…`
      : null;
  return (
    <WorkspaceChrome
      canInvite={canInvite}
      creditStatus={creditStatus}
      isAdmin={isAdmin}
      isStarting={!hostReady || isOpeningProject}
      embeddedAgents={embeddedAgents}
      embeddedSlots={embeddedSlots}
      repository={repository}
      workspaceId={workspaceId}
    >
      <div className="workspace-iframe-wrap">
        {livePreflight ? (
          <ProviderPreflightBanner
            phase={shellReady ? "ready" : "starting"}
            preflight={livePreflight}
          />
        ) : null}
        <iframe
          key={iframeKey}
          ref={iframeRef}
          className="workspace-iframe"
          src={pendingIframeSrc}
          title={repository ? `CoDev — ${repository}` : "CoDev workspace"}
          allow="clipboard-read; clipboard-write"
          onLoad={(event) => {
            disposeIframeBranding.current?.();
            disposeIframeBranding.current = injectOrcaThemeAndBranding(
              event.currentTarget,
              repository || "Workspace",
            );
            deliverPairing();
          }}
        />
        {shellReady ? null : (
          <div
            className="workspace-boot workspace-boot-overlay"
            role="status"
            aria-live="polite"
          >
            <div className="workspace-boot-skeleton" aria-hidden="true">
              <div className="workspace-boot-rail" />
              <div className="workspace-boot-main">
                <div className="workspace-boot-bar" style={{ width: "38%" }} />
                <div className="workspace-boot-bar" style={{ width: "72%" }} />
                <div className="workspace-boot-bar" style={{ width: "54%" }} />
                <div className="workspace-boot-block" />
              </div>
              <div className="workspace-boot-rail workspace-boot-rail-right" />
            </div>
            <p className="workspace-boot-note">
              {failureNotice
                ? failureNotice
                : isSlowStart
                  ? "Still starting — this one is taking longer than usual. It will open on its own."
                  : repository
                    ? `Starting ${repository}…`
                    : "Starting your workspace…"}
            </p>
          </div>
        )}
        {shellReady && !hostReady ? (
          <div className="workspace-boot-pill" role="status">
            <span
              className={`workspace-boot-pill-dot${failureNotice ? " is-failing" : ""}`}
            />
            {failureNotice
              ? failureNotice
              : isSlowStart
                ? "Still starting the workspace…"
                : repository
                  ? `Starting ${repository}…`
                  : "Starting your workspace…"}
            {isSlowStart || failureNotice ? (
              <button
                type="button"
                className="workspace-boot-pill-retry"
                onClick={retry}
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
        {shellReady && hostReady && isOpeningProject ? (
          <div className="workspace-boot-pill" role="status">
            <span className="workspace-boot-pill-dot is-live" />
            Opening project…
          </div>
        ) : null}
      </div>
      <WorkspaceRepositoryDialog
        open={repositoryDialogOpen}
        onClose={() => setRepositoryDialogOpen(false)}
      />
    </WorkspaceChrome>
  );
}
