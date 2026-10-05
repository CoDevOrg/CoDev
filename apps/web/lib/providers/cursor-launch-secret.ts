import "server-only";

import { validateCursorAuthCache } from "./cursor-cli-auth";
import type { ResolvedSecret } from "./registry";

/** Older Cursor connections saved a session JWT instead of the CLI file. */
export function cursorLaunchSecret(contents: string): ResolvedSecret | null {
  try {
    const value = JSON.parse(contents) as Record<string, unknown>;
    const auth = validateCursorAuthCache(value);
    return { kind: "cursor_auth_cache", authCacheJson: auth.serialized };
  } catch {
    const token = contents.trim();
    if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return null;
    // Cursor's explicit auth-token path stores the token in both slots.
    return {
      kind: "cursor_auth_cache",
      authToken: token,
      authCacheJson: JSON.stringify({
        accessToken: token,
        refreshToken: token,
      }),
    };
  }
}
