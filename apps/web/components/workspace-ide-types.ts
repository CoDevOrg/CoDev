import type { AgentSession } from "@/components/agent-panel";
import type { WorkspaceShareMember } from "@/components/share-dialog";
import type { AgentEvent } from "@codev/shared-types";

export type RuntimeStatus =
  | "provisioning"
  | "ready"
  | "hibernated"
  | "stopping"
  | "stopped"
  | "failed";

export interface WorkspaceIdeProps {
  workspaceId: string;
  repository: string;
  branch: string;
  workspaceName: string;
  members: WorkspaceShareMember[];
  initialAgentSessions: AgentSession[];
  initialStateEvents: AgentEvent[];
  runtimeStatus: RuntimeStatus;
  runtimeError?: string | null;
  canStartRuntime: boolean;
  canEdit: boolean;
  canTerminal: boolean;
  canMerge: boolean;
  canReview: boolean;
  canShare: boolean;
  isOwner: boolean;
  integrationHeadSha: string;
  vmMinutesUsed: number;
  vmMinutesQuota: number;
  user: {
    id: string;
    name?: string | null;
    login?: string;
    image?: string | null;
  };
  useClerkAuth?: boolean;
}
