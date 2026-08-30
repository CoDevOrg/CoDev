import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Marker the CoDev renderer puts on an agent launch to say which member is
 * launching it. Carries an id, never a credential: the secret is resolved here
 * in the main process, on the host, and never travels through the browser.
 */
export const CODEV_AGENT_MEMBER_ENV = 'CODEV_AGENT_MEMBER'

/** Control-plane member ids are UUIDs. Validated before it reaches a path so it
 *  can only ever name a direct child of the agents directory. */
const MEMBER_ID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/**
 * Swap a CoDev member marker for that member's own coding-subscription
 * credentials.
 *
 * A CoDev workspace is shared but a linked subscription is personal, and one
 * `orca serve` runs for the whole workspace — so the credential cannot live in
 * that process's own environment (it would be whichever member started the
 * session, for everybody). The orchestrator instead files each member's
 * credentials at `~/.codev/agents/<memberId>/env.json` when they open the
 * workspace (`write_member_agent_credentials`, services/orchestrator/src/backend/orca.rs);
 * this merges the launching member's set into that one PTY's environment.
 *
 * Values already on the launch win, so an explicitly configured env var is
 * never silently replaced. The marker itself is always stripped, and a missing
 * or unreadable bundle just means the agent launches unauthenticated and
 * prompts sign-in itself — never a failed launch.
 */
export async function resolveCodevMemberAgentEnv(
  env: Record<string, string> | undefined,
  home: string = homedir()
): Promise<Record<string, string> | undefined> {
  const memberId = env?.[CODEV_AGENT_MEMBER_ENV]
  if (!env || !memberId) {
    return env
  }

  const { [CODEV_AGENT_MEMBER_ENV]: _marker, ...rest } = env
  if (!MEMBER_ID.test(memberId)) {
    return rest
  }

  try {
    const raw = await readFile(join(home, '.codev', 'agents', memberId, 'env.json'), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return rest
    }
    const resolved: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') {
        resolved[key] = value
      }
    }
    return { ...resolved, ...rest }
  } catch {
    return rest
  }
}
