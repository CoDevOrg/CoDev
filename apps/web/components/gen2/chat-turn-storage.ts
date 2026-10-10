import {
  GEN2_ACTION_TOKEN_PATTERN,
  GEN2_AGENT_PROVIDERS,
  type Gen2AgentProviderName,
} from "@codev/contracts";

const STORAGE_PREFIX = "codev-gen2-turn:";

/** A turn this tab is driving, kept so a reload can rejoin it. */
export type StoredChatTurn = {
  chatId: string;
  sessionId: string;
  after: number;
  provider: Gen2AgentProviderName;
  /** Marks this turn's workspace-action blocks; null for fallback re-runs. */
  actionNonce: string | null;
};

export function readStoredChatTurn(workspaceId: string): StoredChatTurn | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + workspaceId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredChatTurn>;
    if (
      !parsed.chatId ||
      !parsed.sessionId ||
      !GEN2_AGENT_PROVIDERS.some((entry) => entry.id === parsed.provider)
    )
      return null;
    return {
      chatId: parsed.chatId,
      sessionId: parsed.sessionId,
      after: typeof parsed.after === "number" ? parsed.after : 0,
      provider: parsed.provider as Gen2AgentProviderName,
      actionNonce:
        typeof parsed.actionNonce === "string" &&
        GEN2_ACTION_TOKEN_PATTERN.test(parsed.actionNonce)
          ? parsed.actionNonce
          : null,
    };
  } catch {
    return null;
  }
}

export function rememberChatTurn(
  workspaceId: string,
  turn: StoredChatTurn | null,
) {
  try {
    if (turn) {
      sessionStorage.setItem(
        STORAGE_PREFIX + workspaceId,
        JSON.stringify(turn),
      );
    } else {
      sessionStorage.removeItem(STORAGE_PREFIX + workspaceId);
    }
  } catch {
    /* Private mode; the turn still runs in this tab. */
  }
}
