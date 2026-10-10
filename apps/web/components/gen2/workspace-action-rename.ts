import type { Gen2Chat } from "@codev/contracts";

const FAILED = "Couldn’t rename this chat.";

/** Renames a chat; the title changes only once the server accepts it. */
export async function renameWorkspaceChat(
  workspaceId: string,
  chatId: string,
  title: string,
): Promise<{ chat: Gen2Chat } | { error: string }> {
  try {
    const response = await fetch(
      `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/chats/${encodeURIComponent(chatId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      },
    );
    const payload = (await response.json().catch(() => null)) as {
      chat?: Gen2Chat;
      error?: string;
    } | null;
    if (response.ok && payload?.chat) return { chat: payload.chat };
    return { error: payload?.error || FAILED };
  } catch {
    return { error: FAILED };
  }
}
