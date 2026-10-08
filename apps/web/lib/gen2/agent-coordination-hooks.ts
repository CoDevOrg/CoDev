import "server-only";

import {
  PROFILE_DIR_TOKEN,
  type LaunchProfile,
  type ProviderId,
} from "@/lib/providers/registry";

/**
 * PostToolUse hook for native guest-exec turns. codev-guestd supplies the
 * URL, agent ID, and private token in the turn's environment only after the
 * host registers the turn. The token is piped to curl as a header so it never
 * appears in a process argument list; the hook always exits 0 and prints only
 * the host's reply.
 */
export const NATIVE_COORDINATION_HOOK_COMMAND = [
  '[ -n "$CODEV_COORDINATION_URL" ] && [ -n "$CODEV_COORDINATION_AGENT_ID" ] && [ -n "$CODEV_COORDINATION_TOKEN" ] &&',
  `printf 'x-codev-hook-token: %s\\n' "$CODEV_COORDINATION_TOKEN" |`,
  "curl -sf --connect-timeout 0.2 --max-time 0.3 -H @- -H 'content-type: application/json'",
  '--data "{\\"agentId\\":\\"$CODEV_COORDINATION_AGENT_ID\\"}"',
  '"$CODEV_COORDINATION_URL";',
  "exit 0",
].join(" ");

const postToolUseHooks = {
  hooks: {
    PostToolUse: [
      {
        matcher: "*",
        hooks: [{ type: "command", command: NATIVE_COORDINATION_HOOK_COMMAND }],
      },
    ],
  },
};

function withProfileFile(
  profile: LaunchProfile,
  path: string,
  contents: unknown,
): LaunchProfile {
  if (profile.files?.some((file) => file.path === path)) return profile;
  return {
    ...profile,
    files: [
      ...(profile.files ?? []),
      { path, contents: JSON.stringify(contents) },
    ],
  };
}

/**
 * Installs the coordination hook where each CLI reads private hook config:
 * Codex from its profile `CODEX_HOME`, Cursor from the profile `HOME`, and
 * Claude from `--settings`, because Gen 2 disables its settings files with
 * `--setting-sources ""`.
 */
export function withNativeCoordinationHooks(
  provider: ProviderId,
  command: string[],
  profile: LaunchProfile,
): { command: string[]; launchProfile: LaunchProfile } {
  if (provider === "codex") {
    return {
      command,
      launchProfile:
        profile.env?.CODEX_HOME === `${PROFILE_DIR_TOKEN}/.codex`
          ? withProfileFile(profile, ".codex/hooks.json", postToolUseHooks)
          : profile,
    };
  }
  if (provider === "cursor") {
    return {
      command,
      launchProfile:
        profile.env?.HOME === PROFILE_DIR_TOKEN
          ? withProfileFile(profile, ".cursor/hooks.json", {
              version: 1,
              hooks: {
                postToolUse: [{ command: NATIVE_COORDINATION_HOOK_COMMAND }],
              },
            })
          : profile,
    };
  }
  const prompt = command.at(-1);
  if (prompt === undefined) return { command, launchProfile: profile };
  return {
    command: [
      ...command.slice(0, -1),
      "--settings",
      JSON.stringify(postToolUseHooks),
      prompt,
    ],
    launchProfile: profile,
  };
}
