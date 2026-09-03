import {
  CODEV_GITHUB_REPOSITORY,
  CODEV_MEMBER_ID,
  CODEV_WORKSPACE_PATH,
  type CodevBootstrap,
  type CodevDefaultChatAgent
} from './codev-bootstrap'

/**
 * The parent CoDev page opens the embedded client the moment the workspace
 * route mounts, before its EC2 host is awake — the iframe fragment then carries
 * `codev=1&codevPending=1` and nothing runtime-specific. Once the host is up,
 * the parent posts a `codev:pair` message with the pairing offer and the real
 * project path; `main.tsx` saves the runtime environment and remounts `<App>`.
 *
 * This keeps the "instant shell" contract in one testable place: the pending
 * detector and the message validator, sharing `codev-bootstrap.ts`'s regexes
 * so a late pairing is validated exactly like a fragment-delivered one.
 */

export type CodevPairPayload = {
  /** Base64url pairing offer, same shape `readPairingInputFromLocation` yields. */
  pairing: string
  bootstrap: CodevBootstrap
}

/** True when CoDev mounted the client ahead of its host and will deliver the
 *  pairing offer and project path later over a `codev:pair` message. */
export function readCodevPendingEmbed(location: Pick<Location, 'hash'>): boolean {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''))
  return params.get('codev') === '1' && params.get('codevPending') === '1'
}

function readDefaultAgent(value: unknown): CodevDefaultChatAgent | undefined {
  return value === 'claude' || value === 'codex' ? value : undefined
}

/**
 * Validates a `codev:pair` message body. Returns null for anything that is not
 * a well-formed pairing for this workspace — the caller ignores it rather than
 * booting against an unverified project path or endpoint.
 */
export function parseCodevPairMessage(data: unknown): CodevPairPayload | null {
  if (!data || typeof data !== 'object') {
    return null
  }
  const message = data as Record<string, unknown>
  if (message.type !== 'codev:pair') {
    return null
  }
  const pairing = typeof message.pairing === 'string' ? message.pairing.trim() : ''
  if (!pairing) {
    return null
  }
  const projectPath = message.projectPath
  if (typeof projectPath !== 'string' || !CODEV_WORKSPACE_PATH.test(projectPath)) {
    return null
  }
  const projectKind = message.projectKind
  if (projectKind !== 'git' && projectKind !== 'folder') {
    return null
  }
  const projectName =
    typeof message.projectName === 'string' && CODEV_GITHUB_REPOSITORY.test(message.projectName)
      ? message.projectName
      : undefined
  const defaultAgent = readDefaultAgent(message.defaultAgent)
  const memberId =
    typeof message.memberId === 'string' && CODEV_MEMBER_ID.test(message.memberId)
      ? message.memberId
      : undefined
  const cursorAvailable = message.cursorAvailable === true

  return {
    pairing,
    bootstrap: {
      projectPath,
      projectKind,
      ...(projectName ? { projectName } : {}),
      ...(defaultAgent ? { defaultAgent } : {}),
      ...(memberId ? { memberId } : {}),
      ...(cursorAvailable ? { cursorAvailable: true } : {})
    }
  }
}
