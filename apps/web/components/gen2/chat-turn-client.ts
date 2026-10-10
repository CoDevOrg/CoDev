import {
  GEN2_ACTION_TOKEN_PATTERN,
  type Gen2AgentProviderName,
  type Gen2Chat,
  type Gen2PossibleDuplicateTask,
} from "@codev/contracts";

import {
  gen2ChatUploadPath,
  isNonTextFileContents,
} from "@/lib/gen2/chat-attachments";

/** What the server said to a turn start. */
export type ChatStartResult =
  | {
      kind: "started";
      sessionId: string;
      actionNonce: string | null;
      fallback: boolean;
    }
  /** `/goal clear` or `/goal done`: saved, and no agent runs. */
  | { kind: "goal" }
  | { kind: "duplicate"; duplicate: Gen2PossibleDuplicateTask }
  | { kind: "failed"; error: string | null; status: number };

const JSON_HEADERS = { "Content-Type": "application/json" };

/** Creates a chat for the first turn; null when the server refused. */
export async function createChat(
  workspaceId: string,
  provider: Gen2AgentProviderName,
) {
  const response = await fetch(`/api/gen2/workspaces/${workspaceId}/chats`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ provider }),
  });
  if (!response.ok) return null;
  return ((await response.json()) as { chat: Gen2Chat }).chat;
}

/** Writes attachments under the upload directory on the workspace. */
export async function uploadChatAttachments(
  workspaceId: string,
  files: File[],
): Promise<{ paths: string[]; error?: string }> {
  const paths: string[] = [];
  for (const file of files) {
    const contents = await file.text();
    if (isNonTextFileContents(contents))
      return { paths, error: `${file.name} is not a text file.` };
    const path = gen2ChatUploadPath(file.name);
    const response = await fetch(`/api/gen2/workspaces/${workspaceId}/files`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ path, contents, overwrite: true }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      return {
        paths,
        error: payload.error ?? `${file.name} could not be uploaded.`,
      };
    }
    paths.push(path);
  }
  return { paths };
}

/** Starts a turn; network failures throw. */
export async function postChatTurn(
  workspaceId: string,
  body: Record<string, unknown>,
): Promise<ChatStartResult> {
  const response = await fetch(`/api/gen2/workspaces/${workspaceId}/agent`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    sessionId?: string;
    actionNonce?: string;
    error?: string;
    possibleDuplicate?: Gen2PossibleDuplicateTask;
    fallback?: unknown;
    goal?: unknown;
  };
  if (response.ok && payload.possibleDuplicate)
    return { kind: "duplicate", duplicate: payload.possibleDuplicate };
  if (response.ok && "goal" in payload) return { kind: "goal" };
  if (!response.ok || !payload.sessionId)
    return {
      kind: "failed",
      error: payload.error ?? null,
      status: response.status,
    };
  return {
    kind: "started",
    sessionId: payload.sessionId,
    actionNonce:
      payload.actionNonce && GEN2_ACTION_TOKEN_PATTERN.test(payload.actionNonce)
        ? payload.actionNonce
        : null,
    fallback: Boolean(payload.fallback),
  };
}
