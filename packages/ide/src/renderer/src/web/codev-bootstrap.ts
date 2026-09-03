/**
 * Agents CoDev is allowed to open the workspace's default chat tab with. Kept
 * narrow on purpose: only the native-chat-rendered CLIs whose credentials the
 * CoDev runtime host injects (see `docs/provider-oauth-openai-codex.md` and the
 * linked Anthropic credential injection).
 */
export type CodevDefaultChatAgent = 'claude' | 'codex'

export type CodevBootstrap = {
  projectPath: string
  projectKind: 'git' | 'folder'
  projectName?: string
  /**
   * Which agent the workspace's default chat tab launches with. Absent when the
   * pairing fragment does not pin one; consumers fall back to their own default.
   */
  defaultAgent?: CodevDefaultChatAgent
  /**
   * The signed-in CoDev member. Agents launched here run on this member's own
   * linked subscription. An id, never a credential — the host resolves the
   * secret itself.
   */
  memberId?: string
  /**
   * Personal settings surface: CoDev opened this client outside any workspace
   * to render the signed-in member's own settings, so workspace-scoped
   * settings and the workspace chrome are hidden.
   */
  settingsOnly?: boolean
  /**
   * Whether this member has linked a Cursor credential. Unlike Claude/Codex,
   * Cursor has no host-injected fallback — offering it as a switch target
   * without this would strand an unlinked member on cursor-agent's own
   * sign-in wall.
   */
  cursorAvailable?: boolean
}

function readDefaultAgent(value: string | null): CodevDefaultChatAgent | null {
  return value === 'claude' || value === 'codex' ? value : null
}

// codev-orchestrator validates every session's project root against one
// configured workspaces root joined with the session id (see
// services/orchestrator/src/backend/orca.rs) — it has no separate notion of
// a personal-runtime root, so a settings-only (personal) pairing lives under
// this same path, keyed by the member's own id instead of a workspace id.
// Exported so the late-pairing path (`codev-pair-message.ts`) validates the
// project path it receives over postMessage against the exact same shape.
export const CODEV_WORKSPACE_PATH =
  /^\/srv\/codev\/workspaces\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const CODEV_GITHUB_REPOSITORY = /^[a-z0-9_.-]{1,100}\/[a-z0-9_.-]{1,100}$/i
export const CODEV_MEMBER_ID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export function readCodevBootstrap(location: Pick<Location, 'hash'>): CodevBootstrap | null {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''))
  if (params.get('codev') !== '1') {
    return null
  }

  const projectPath = params.get('codevProject')
  const projectKind = params.get('codevProjectKind')
  const projectName = params.get('codevProjectName')
  const defaultAgent = readDefaultAgent(params.get('codevDefaultAgent'))
  const memberIdParam = params.get('codevMemberId')
  const memberId = memberIdParam && CODEV_MEMBER_ID.test(memberIdParam) ? memberIdParam : null
  const settingsOnly = params.get('codevSettingsOnly') === '1'
  const cursorAvailable = params.get('codevCursorAvailable') === '1'
  if (!projectPath || (projectKind !== 'git' && projectKind !== 'folder')) {
    return null
  }
  if (!CODEV_WORKSPACE_PATH.test(projectPath)) {
    return null
  }
  if (projectName && !CODEV_GITHUB_REPOSITORY.test(projectName)) {
    return null
  }

  return {
    projectPath,
    projectKind,
    ...(projectName ? { projectName } : {}),
    ...(defaultAgent ? { defaultAgent } : {}),
    ...(memberId ? { memberId } : {}),
    ...(settingsOnly ? { settingsOnly: true } : {}),
    ...(cursorAvailable ? { cursorAvailable: true } : {})
  }
}
