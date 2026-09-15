/* eslint-disable max-lines -- Why: preload is the audited renderer/Electron IPC contract; co-locating the surface eases security and type-drift review. */
import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { preloadE2EConfig } from './e2e-config'
import type { AppIdentity } from '../shared/app-identity'
import type {
  DashboardRevealAgentArgs,
  DashboardSleepWorkspaceArgs,
  DashboardSpawnAgentArgs
} from '../shared/dashboard-snapshot'
import type {
  TerminalPreviewConnectResult,
  TerminalPreviewDataPayload
} from '../shared/terminal-preview'
import type { CliInstallStatus } from '../shared/cli-install-types'
import type { AgentHookInstallStatus } from '../shared/agent-hook-types'
import type { CodexConfigSyncStatus } from '../shared/codex-config-sync-types'
import type { TerminalPaneSplitSource } from '../shared/feature-education-telemetry'
import type { TerminalTabCreateReply } from '../shared/terminal-reveal-identity'
import type { ProjectExecutionRuntimeResolution } from '../shared/project-execution-runtime'
import type { StartupCommandDelivery } from '../shared/codex-startup-delivery'
import type {
  AgentProviderSessionMetadata,
  SleepingAgentLaunchConfig
} from '../shared/agent-session-resume'
import type { MobileRelayStatus } from '../shared/mobile-relay-status'
import type { MobilePairingConnectionMode } from '../shared/mobile-pairing-connection-mode'
import type { RuntimePairingReach } from '../shared/runtime-pairing-reach'
import type { MobileRelayMintFailure } from '../shared/mobile-relay-mint-failure'
import type { VerifyAndAddRuntimeEnvironmentResult } from '../shared/remote-pairing-verification'
import type {
  HostRepoCatalogSnapshot,
  ListReposForExecutionHostArgs
} from '../shared/host-repo-catalog-contract'
import type {
  HostLineageSnapshot,
  ListDesktopLineageForHostArgs
} from '../shared/host-lineage-contract'
import type {
  PluginPanelActionOutcome,
  PluginPanelEntry
} from '../shared/plugins/plugin-panel-bridge'
import type { PluginConsentRequest } from '../shared/plugins/plugin-consent-request'
import type { PluginChangeEvent } from '../shared/plugins/plugin-change-event'
import type {
  BaseRefSearchResult,
  BaseRefDefaultResult,
  BrowserViewportOverride,
  CustomPet,
  FsChangedPayload,
  GetRateLimitResult,
  GitHubPRRefreshCandidate,
  GitHubPRRefreshEvent,
  GitHubPRRefreshReason,
  GitHubAssignableUser,
  GitHubCommentResult,
  GitHubCreateIssueResult,
  GitHubOwnerRepo,
  GitHubWorkItem,
  GitPushTarget,
  GitStagingArea,
  GitForkSyncExpectedUpstream,
  GitForkSyncResult,
  GitUpstreamStatus,
  GhosttyImportPreview,
  ListWorkItemsResult,
  MemorySnapshot,
  NotificationDismissResult,
  NotificationDispatchResult,
  NotificationDeliveryProbeResult,
  NotificationPermissionStatusResult,
  NotificationSoundDataResult,
  NotificationSoundPathResult,
  NotificationSoundResult,
  NestedRepoScanResult,
  OnboardingState,
  PersistedUIState,
  FloatingTerminalCwdRequest,
  MarkdownDocument,
  SearchResult,
  TuiAgent,
  WorktreeBaseStatusEvent,
  WorktreeDefaultTabsLaunch,
  WorktreeHeadIdentity,
  WorktreeRemoteBranchConflictEvent,
  WorktreeSetupLaunch
} from '../shared/types'
import type { PtyModelRestoreNeededEvent } from '../shared/pty-model-restore-marker'
import type { PtyListedSession } from '../shared/pty-listed-session'
import type {
  PtyRendererDeliveryHealthReply,
  PtyRendererDeliveryStateReport
} from '../shared/pty-renderer-delivery-health'
import type { TerminalViewAttributes } from '../shared/terminal-view-attributes'
import type { WriteTerminalRenderDesyncEvidenceArgs } from '../shared/terminal-render-desync-evidence'
import type { PtyMainDeliveryDiagnostics } from '../shared/pty-delivery-diagnostics'
import type {
  WarpThemeImportPreview,
  WarpThemeImportSource
} from '../shared/terminal-custom-themes'
import type { GitHistoryOptions, GitHistoryResult } from '../shared/git-history'
import type {
  ShellOpenExternalEditorRequest,
  ShellOpenExternalEditorResult,
  ShellOpenLocalPathResult
} from '../shared/shell-open-types'
import type { SkillDiscoveryResult, SkillDiscoveryTarget } from '../shared/skills'
import type {
  SkillFreshnessInventory,
  SkillUpdateRun,
  SkillUpdateStartResult
} from '../shared/skill-freshness'
import type {
  RuntimeBrowserDriverState,
  RuntimeMobileSessionTabMove,
  RuntimeStatus,
  RuntimeSyncWindowGraphResult,
  RuntimeSyncWindowGraph,
  RuntimeTerminalCreateRequestPayload,
  RuntimeTerminalDriverState,
  RuntimeTerminalPresentation
} from '../shared/runtime-types'
import type { RuntimeRpcResponse } from '../shared/runtime-rpc-envelope'
import type { PublicKnownRuntimeEnvironment } from '../shared/runtime-environments'
import type {
  RuntimeMobileMarkdownRequest,
  RuntimeMobileMarkdownResponse
} from '../shared/mobile-markdown-document'
import type {
  CodexRateLimitResetResult,
  RateLimitRuntimeTarget,
  RateLimitState
} from '../shared/rate-limit-types'
import type { WorkspaceSpaceScanProgress } from '../shared/workspace-space-types'
import type { WorkspaceCleanupScanProgress } from '../shared/workspace-cleanup'
import type { WorkspacePortAdvertisedUrlChangedEvent } from '../shared/workspace-ports'
import type { GhAuthDiagnostic } from '../shared/github-auth-types'
import type { TaskSourceContext } from '../shared/task-source-context'
import type {
  AddIssueCommentBySlugArgs,
  ClearProjectItemFieldArgs,
  DeleteIssueCommentBySlugArgs,
  GetProjectViewTableArgs,
  GetProjectViewTableResult,
  GitHubProjectCommentMutationResult,
  GitHubProjectMutationResult,
  ListAccessibleProjectsArgs,
  ListAccessibleProjectsResult,
  ListAssignableUsersBySlugArgs,
  ListAssignableUsersBySlugResult,
  ListIssueTypesBySlugArgs,
  ListIssueTypesBySlugResult,
  ListLabelsBySlugArgs,
  ListLabelsBySlugResult,
  ListProjectViewsArgs,
  ListProjectViewsResult,
  ProjectWorkItemDetailsBySlugArgs,
  ProjectWorkItemDetailsBySlugResult,
  ResolveProjectRefArgs,
  ResolveProjectRefResult,
  UpdateIssueBySlugArgs,
  UpdateIssueCommentBySlugArgs,
  UpdateIssueTypeBySlugArgs,
  UpdatePullRequestBySlugArgs,
  UpdateProjectItemFieldArgs
} from '../shared/github-project-types'
import {
  richMarkdownContextMenuCommandChannel,
  richMarkdownContextMenuTargetChannel,
  type RichMarkdownContextMenuCommandPayload,
  type RichMarkdownContextMenuTableTarget
} from '../shared/rich-markdown-context-menu'
import type {
  AgentStatusClearIpcPayload,
  AgentStatusIpcPayload,
  MigrationUnsupportedPtyEntry
} from '../shared/agent-status-types'
import type { AgentInterruptInferenceRequest } from '../shared/agent-interrupt-intent'
import type { AgentQuestionAnsweredInferenceRequest } from '../shared/agent-question-answered-intent'
import type { TerminalSideEffectBatch } from '../shared/terminal-side-effect-facts'
import type { TelemetryConsentState } from '../shared/telemetry-consent-types'
import type {
  PreflightRuntimeContext,
  RefreshAgentsResult,
  NativeChatAppendedPayload,
  NativeChatReadSessionResult,
  NativeChatSubscriptionFrame,
  PluginHostInstallResult,
  PluginHostInstallSource,
  PluginHostListEntry,
  PluginHostLogLine,
  PreloadApi
} from './api-types'
import type { AgentKind, LaunchSource, RequestKind } from '../shared/telemetry-events'
import { createBrowserFindSubscriptions } from './browser-find-subscriptions'
import type { AppStarSource } from '../shared/gh-star-source'
import type { ExecutionHostId } from '../shared/execution-host'
import type {
  Automation,
  AutomationCreateInput,
  AutomationDispatchRequest,
  AutomationDispatchResult,
  ExternalAutomationCreateInput,
  ExternalAutomationActionInput,
  ExternalAutomationManager,
  ExternalAutomationRunsInput,
  ExternalAutomationRunsPage,
  ExternalAutomationUpdateInput,
  AutomationRun,
  AutomationPrecheckResult,
  AutomationUpdateInput
} from '../shared/automations-types'
import type { KeybindingActionId, KeybindingFileSnapshot } from '../shared/keybindings'
import type {
  AiVaultFirstUserPromptArgs,
  AiVaultListArgs,
  AiVaultSubagentListArgs
} from '../shared/ai-vault-types'
import type { AiVaultPrepareSessionResumeArgs } from '../shared/ai-vault-resume-preparation'
import type { AgentType } from '../shared/native-chat-types'
import {
  ORCA_INTERNAL_FILE_DRAG_TYPE,
  createNativeFileDropPayload,
  createRejectedNativeFileDropPayload,
  hasNativeFileDragTypes,
  NATIVE_FILE_DROP_MAX_PATHS,
  resolveNativeFileDropPath,
  type NativeDropResolution,
  type NativeFileDropPayload,
  type NativeFileDropPathEntry
} from '../shared/native-file-drop'
import type {
  LocalLogTailChangedPayload,
  LocalLogTailReadArgs,
  LocalLogTailReadResult,
  LocalLogTailWatchArgs
} from '../shared/local-log-tail-types'
import { subscribeRuntimeEnvironmentFromPreload } from './runtime-environment-subscriptions'
import type { RuntimeEnvironmentSubscriptionHandle } from './runtime-environment-subscriptions'
import type { HostedReviewForBranchArgs } from '../shared/hosted-review'
import type { ReadClipboardTextOptions } from '../shared/clipboard-text'
import type {
  LocalhostWorktreeLabelResult,
  LocalhostWorktreeLabelRoute
} from '../shared/localhost-worktree-labels'
import type {
  CrashReportBreadcrumbData,
  CrashReportCopyDiagnosticsArgs,
  CrashReportSubmitArgs,
  CrashReportSubmitResult,
  ReactErrorBoundaryReportArgs,
  ReactErrorBoundaryReportResult
} from '../shared/crash-reporting'
import type { RendererHeapStatistics } from '../shared/renderer-heap-statistics'
import { readRendererHeapStatistics } from './renderer-heap-statistics-reader'
import {
  prepareAndInvokeAppRestart,
  registerRendererRestartIpcRelays
} from './renderer-restart-wiring'

// Why: the sync checkpoint only stages; this joins its durable write so a
// navigating path can abort instead of losing the staged session.
async function awaitBeforeUnloadCheckpoint(): Promise<void> {
  const result = (await ipcRenderer.invoke('app:await-before-unload-checkpoint')) as {
    ok?: unknown
  }
  if (result?.ok !== true) {
    throw new Error('Failed to persist renderer state before unload.')
  }
}

type NativeFileDropCallback = (data: NativeFileDropPayload) => void

const nativeFileDropCallbacks: NativeFileDropCallback[] = []
let nativeFileDropListenerRegistered = false
registerRendererRestartIpcRelays(ipcRenderer, window)

function getLinuxDisplayServer(): 'wayland' | 'x11' | null {
  if (process.platform !== 'linux') {
    return null
  }
  if (
    process.env.WAYLAND_DISPLAY ||
    process.env.XDG_SESSION_TYPE?.toLowerCase() === 'wayland' ||
    process.env.ELECTRON_OZONE_PLATFORM_HINT?.toLowerCase() === 'wayland'
  ) {
    return 'wayland'
  }
  return process.env.DISPLAY ? 'x11' : null
}

const onNativeFileDrop = (_event: Electron.IpcRendererEvent, data: NativeFileDropPayload): void => {
  for (const callback of Array.from(nativeFileDropCallbacks)) {
    callback(data)
  }
}

function subscribeNativeFileDrop(callback: NativeFileDropCallback): () => void {
  nativeFileDropCallbacks.push(callback)
  if (!nativeFileDropListenerRegistered) {
    // Why: keep one real IPC listener and fan out locally — panes subscribe per split group, which would otherwise trip listener warnings.
    ipcRenderer.on('terminal:file-drop', onNativeFileDrop)
    nativeFileDropListenerRegistered = true
  }
  return () => {
    const callbackIndex = nativeFileDropCallbacks.indexOf(callback)
    if (callbackIndex !== -1) {
      nativeFileDropCallbacks.splice(callbackIndex, 1)
    }
    if (nativeFileDropCallbacks.length === 0 && nativeFileDropListenerRegistered) {
      ipcRenderer.removeListener('terminal:file-drop', onNativeFileDrop)
      nativeFileDropListenerRegistered = false
    }
  }
}

// Why: cache one shared Audio + blob URL per sound path so we don't re-read 10MB from disk and re-transfer over IPC on every notification.
let cachedNotificationSound: {
  path: string
  blobUrl: string
  audio: HTMLAudioElement
} | null = null
let isNotificationSoundPlaying = false
// Why: audio.play() can reject before ended/error fires — cleanup hook prevents leaked listeners on the cached Audio.
let cleanupNotificationSoundPlayback: (() => void) | null = null

function clearNotificationSoundPlaybackState(): void {
  cleanupNotificationSoundPlayback?.()
  cleanupNotificationSoundPlayback = null
  isNotificationSoundPlaying = false
}

function disposeCachedNotificationSound(): void {
  if (cachedNotificationSound) {
    clearNotificationSoundPlaybackState()
    cachedNotificationSound.audio.pause()
    cachedNotificationSound.audio.src = ''
    URL.revokeObjectURL(cachedNotificationSound.blobUrl)
    cachedNotificationSound = null
  }
}

/**
 * Classify which UI surface the native OS drop landed on, and for file-explorer drops
 * extract the destination directory from `data-native-file-drop-dir`.
 *
 * Why: preload consumes the native `drop` before React can read paths, so it must capture
 * the destination dir now — otherwise the renderer can't tell "root" from "inside this folder".
 */
function resolveNativeFileDrop(event: DragEvent): NativeDropResolution | null {
  const pathEntries: NativeFileDropPathEntry[] = []
  for (const entry of event.composedPath()) {
    if (entry instanceof HTMLElement) {
      pathEntries.push({
        nativeFileDropTarget: entry.dataset.nativeFileDropTarget,
        nativeFileDropDir: entry.dataset.nativeFileDropDir,
        terminalTabId: entry.dataset.terminalTabId,
        terminalPaneLeafId: entry.dataset.terminalPaneLeafId ?? entry.dataset.leafId
      })
    }
  }
  return resolveNativeFileDropPath(pathEntries)
}

// File drag-and-drop lives in preload because webUtils (File→path) is only available in the preload/main world, not the renderer's isolated world.
document.addEventListener(
  'dragover',
  (e) => {
    // Let in-app drags through to React handlers (their own dropEffect); only override for native OS file drops.
    if (e.dataTransfer && !hasNativeFileDragTypes(e.dataTransfer.types)) {
      return
    }
    e.preventDefault()
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy'
    }
  },
  true
)

document.addEventListener(
  'drop',
  (e) => {
    // Let in-app drags (e.g. file explorer → terminal) through to React handlers
    if (e.dataTransfer?.types.includes(ORCA_INTERNAL_FILE_DRAG_TYPE)) {
      return
    }

    e.preventDefault()
    e.stopPropagation()
    const files = e.dataTransfer?.files
    if (!files || files.length === 0) {
      return
    }
    const resolution = resolveNativeFileDrop(e)

    // Why: reject oversized gestures by count before resolving every File object (path resolution is synchronous here).
    if (files.length > NATIVE_FILE_DROP_MAX_PATHS) {
      ipcRenderer.send(
        'terminal:file-dropped-from-preload',
        createRejectedNativeFileDropPayload({
          byteLength: 0,
          pathCount: files.length,
          reason: 'too-many-paths',
          status: 'rejected'
        })
      )
      return
    }

    const paths: string[] = []
    for (let i = 0; i < files.length; i++) {
      // webUtils.getPathForFile is the Electron 28+ replacement for File.path
      const filePath = webUtils.getPathForFile(files[i])
      if (filePath) {
        paths.push(filePath)
      }
    }

    if (paths.length === 0) {
      return
    }

    // Why: explorer marker present but no destination dir resolved → reject entirely, no editor fallback (fail-closed, design §7.1).
    if (resolution?.target === 'rejected') {
      return
    }

    const payload = createNativeFileDropPayload(resolution, paths)
    if (!payload) {
      return
    }
    // Why: emit exactly one native-drop event per gesture (the shared planner rejects oversized payloads without leaking path contents).
    ipcRenderer.send('terminal:file-dropped-from-preload', payload)
  },
  true
)

const startupDiagnosticsEnabled = process.env.ORCA_STARTUP_DIAGNOSTICS === '1'
const browserFindSubscriptions = createBrowserFindSubscriptions()

ipcRenderer.on('ui:findInBrowserPage', (_event, source: unknown) => {
  browserFindSubscriptions.dispatch(source)
})

// Custom APIs for renderer
const api = {
  app: {
    getIdentity: (): Promise<AppIdentity> => ipcRenderer.invoke('app:getIdentity'),
    getFeatureWallAssetBaseUrl: (): Promise<string> =>
      ipcRenderer.invoke('app:getFeatureWallAssetBaseUrl'),
    relaunch: (): Promise<void> =>
      prepareAndInvokeAppRestart(
        window,
        () => ipcRenderer.invoke('app:relaunch'),
        awaitBeforeUnloadCheckpoint
      ),
    restart: (): Promise<void> =>
      prepareAndInvokeAppRestart(
        window,
        () => ipcRenderer.invoke('app:restart'),
        awaitBeforeUnloadCheckpoint
      ),
    reload: (): Promise<void> =>
      prepareAndInvokeAppRestart(
        window,
        () => ipcRenderer.invoke('app:reload'),
        awaitBeforeUnloadCheckpoint
      ),
    stageBeforeUnloadSync: (args: Parameters<PreloadApi['app']['stageBeforeUnloadSync']>[0]) => {
      const result = ipcRenderer.sendSync('app:stage-before-unload-sync', args) as {
        ok?: unknown
      }
      if (result?.ok !== true) {
        throw new Error('Failed to stage renderer state before unload.')
      }
    },
    awaitFirstWindowStartupServices: (): Promise<void> =>
      ipcRenderer.invoke('app:awaitFirstWindowStartupServices'),
    recoverLegacyWorkerTerminalsForRendererStartup: (): Promise<void> =>
      ipcRenderer.invoke('app:recoverLegacyWorkerTerminalsForRendererStartup'),
    startupDiagnostic: (event: string, details?: Record<string, unknown>): Promise<void> =>
      startupDiagnosticsEnabled
        ? ipcRenderer.invoke('app:startupDiagnostic', event, details)
        : Promise.resolve(),
    // Why: macOS input mode (or layout ID) so keyboard workarounds can tell CJK/compose layouts from US QWERTY (issue #1205); null on non-Darwin or read failure.
    getKeyboardInputSourceId: (): Promise<string | null> =>
      ipcRenderer.invoke('app:getKeyboardInputSourceId'),
    // Why: the macOS dock badge module is gone; keep the renderer hook's call a no-op.
    setUnreadDockBadgeCount: (): Promise<void> => Promise.resolve(),
    getFloatingTerminalCwd: (args?: FloatingTerminalCwdRequest): Promise<string> =>
      ipcRenderer.invoke('app:getFloatingTerminalCwd', args),
    getFloatingMarkdownDirectory: (): Promise<string> =>
      ipcRenderer.invoke('app:getFloatingMarkdownDirectory'),
    pickFloatingMarkdownDocument: (): Promise<MarkdownDocument | null> =>
      ipcRenderer.invoke('app:pickFloatingMarkdownDocument'),
    pickFloatingWorkspaceDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke('app:pickFloatingWorkspaceDirectory'),
    writeTerminalRenderDesyncEvidence: (args: WriteTerminalRenderDesyncEvidenceArgs) =>
      ipcRenderer.invoke('terminal:writeRenderDesyncEvidence', args)
  },

  orcaProfiles: {
    list: () => ipcRenderer.invoke('orcaProfiles:list'),
    authStatus: () => ipcRenderer.invoke('orcaProfiles:authStatus'),
    createLocal: (args) => ipcRenderer.invoke('orcaProfiles:createLocal', args),
    createCloudLinked: (args) => ipcRenderer.invoke('orcaProfiles:createCloudLinked', args),
    switchProfile: (args) => ipcRenderer.invoke('orcaProfiles:switch', args),
    transferProject: (args) => ipcRenderer.invoke('orcaProfiles:transferProject', args),
    findProjectProfiles: (args) => ipcRenderer.invoke('orcaProfiles:findProjectProfiles', args),
    connectCurrent: () => ipcRenderer.invoke('orcaProfiles:connectCurrent'),
    refreshAuth: () => ipcRenderer.invoke('orcaProfiles:refreshAuth'),
    signOutCurrent: () => ipcRenderer.invoke('orcaProfiles:signOutCurrent'),
    selectOrg: (args) => ipcRenderer.invoke('orcaProfiles:selectOrg', args),
    orgMembersList: (args) => ipcRenderer.invoke('orcaProfiles:orgMembersList', args),
    orgMemberInvite: (args) => ipcRenderer.invoke('orcaProfiles:orgMemberInvite', args),
    orgInviteRevoke: (args) => ipcRenderer.invoke('orcaProfiles:orgInviteRevoke', args),
    orgMemberChangeRole: (args) => ipcRenderer.invoke('orcaProfiles:orgMemberChangeRole', args),
    orgMemberRemove: (args) => ipcRenderer.invoke('orcaProfiles:orgMemberRemove', args)
  } satisfies PreloadApi['orcaProfiles'],

  platform: {
    get: () => ({
      platform: process.platform,
      osRelease:
        (process as NodeJS.Process & { getSystemVersion?: () => string }).getSystemVersion?.() ??
        '',
      displayServer: getLinuxDisplayServer()
    })
  } satisfies PreloadApi['platform'],

  wsl: {
    isAvailable: (): Promise<boolean> => ipcRenderer.invoke('wsl:isAvailable'),
    listDistros: (): Promise<string[]> => ipcRenderer.invoke('wsl:listDistros')
  },

  pwsh: {
    isAvailable: (): Promise<boolean> => ipcRenderer.invoke('pwsh:isAvailable')
  },

  gitBash: {
    isAvailable: (): Promise<boolean> => ipcRenderer.invoke('gitBash:isAvailable')
  },

  plugins: {
    list: (): Promise<PluginHostListEntry[]> => ipcRenderer.invoke('plugins:list'),
    listLanguagePacks: () => ipcRenderer.invoke('plugins:listLanguagePacks'),
    consent: (args: PluginConsentRequest): Promise<PluginHostListEntry[]> =>
      ipcRenderer.invoke('plugins:consent', args),
    setEnabled: (args: { pluginKey: string; enabled: boolean }): Promise<PluginHostListEntry[]> =>
      ipcRenderer.invoke('plugins:setEnabled', args),
    readPanelEntry: (args: {
      pluginKey: string
      panelId: string
    }): Promise<PluginPanelEntry | null> => ipcRenderer.invoke('plugins:readPanelEntry', args),
    invokeCommand: (args: {
      pluginKey: string
      commandId: string
      args?: unknown
    }): Promise<unknown> => ipcRenderer.invoke('plugins:invokeCommand', args),
    panelAction: (args: {
      sessionToken: string
      action: string
      params?: unknown
    }): Promise<PluginPanelActionOutcome> => ipcRenderer.invoke('plugins:panelAction', args),
    install: (source: PluginHostInstallSource): Promise<PluginHostInstallResult> =>
      ipcRenderer.invoke('plugins:install', source),
    listMarketplaces: () => ipcRenderer.invoke('plugins:listMarketplaces'),
    addMarketplace: (source) => ipcRenderer.invoke('plugins:addMarketplace', source),
    removeMarketplace: (args) => ipcRenderer.invoke('plugins:removeMarketplace', args),
    refreshMarketplaces: (args = {}) => ipcRenderer.invoke('plugins:refreshMarketplaces', args),
    listMarketplacePlugins: () => ipcRenderer.invoke('plugins:listMarketplacePlugins'),
    previewMarketplacePlugin: (args) =>
      ipcRenderer.invoke('plugins:previewMarketplacePlugin', args),
    installMarketplacePlugin: (preview) =>
      ipcRenderer.invoke('plugins:installMarketplacePlugin', preview),
    previewMarketplaceUpdate: (args) =>
      ipcRenderer.invoke('plugins:previewMarketplaceUpdate', args),
    rollbackMarketplacePlugin: (args) =>
      ipcRenderer.invoke('plugins:rollbackMarketplacePlugin', args),
    remove: (args: { pluginKey: string }): Promise<PluginHostListEntry[]> =>
      ipcRenderer.invoke('plugins:remove', args),
    getLogs: (args: { pluginKey: string }): Promise<PluginHostLogLine[]> =>
      ipcRenderer.invoke('plugins:getLogs', args),
    refresh: (): Promise<PluginHostListEntry[]> => ipcRenderer.invoke('plugins:refresh'),
    onChanged: (callback): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, change: PluginChangeEvent): void =>
        callback(change)
      ipcRenderer.on('plugins:changed', listener)
      return () => {
        ipcRenderer.removeListener('plugins:changed', listener)
      }
    }
  } satisfies PreloadApi['plugins'],

  repos: {
    list: () => ipcRenderer.invoke('repos:list'),

    listForExecutionHost: (args: ListReposForExecutionHostArgs): Promise<HostRepoCatalogSnapshot> =>
      ipcRenderer.invoke('repos:listForExecutionHost', args),

    add: (args) => ipcRenderer.invoke('repos:add', args),

    addRemote: (args) => ipcRenderer.invoke('repos:addRemote', args),

    create: (args) => ipcRenderer.invoke('repos:create', args),

    isGitAvailable: (): Promise<boolean> => ipcRenderer.invoke('repos:isGitAvailable'),

    getDefaultCreateProjectParent: (): Promise<string> =>
      ipcRenderer.invoke('repos:getDefaultCreateProjectParent'),

    remove: (args) => ipcRenderer.invoke('repos:remove', args),

    removeForHost: (args) => ipcRenderer.invoke('repos:removeForHost', args),

    reorder: (args) => ipcRenderer.invoke('repos:reorder', args),

    reorderForHost: (args) => ipcRenderer.invoke('repos:reorderForHost', args),

    update: (args) => ipcRenderer.invoke('repos:update', args),

    pickFolder: () => ipcRenderer.invoke('repos:pickFolder'),

    pickFolders: () => ipcRenderer.invoke('repos:pickFolders'),

    pickDirectory: () => ipcRenderer.invoke('repos:pickDirectory'),

    clone: (args) => ipcRenderer.invoke('repos:clone', args),

    cloneRemote: (args) => ipcRenderer.invoke('repos:cloneRemote', args),

    createRemote: (args) => ipcRenderer.invoke('repos:createRemote', args),

    cloneAbort: () => ipcRenderer.invoke('repos:cloneAbort'),

    onCloneProgress: (
      callback: (data: { phase: string; percent: number }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { phase: string; percent: number }
      ) => callback(data)
      ipcRenderer.on('repos:clone-progress', listener)
      return () => ipcRenderer.removeListener('repos:clone-progress', listener)
    },

    getGitUsername: (args: { repoId: string }): Promise<string> =>
      ipcRenderer.invoke('repos:getGitUsername', args),

    getBaseRefDefault: (args: {
      repoId: string
      hostId?: ExecutionHostId
    }): Promise<BaseRefDefaultResult> => ipcRenderer.invoke('repos:getBaseRefDefault', args),

    searchBaseRefs: (args: {
      repoId: string
      query: string
      limit?: number
      hostId?: ExecutionHostId
    }): Promise<string[]> => ipcRenderer.invoke('repos:searchBaseRefs', args),

    searchBaseRefDetails: (args: {
      repoId: string
      query: string
      limit?: number
      hostId?: ExecutionHostId
    }): Promise<BaseRefSearchResult[]> => ipcRenderer.invoke('repos:searchBaseRefDetails', args),

    onChanged: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('repos:changed', listener)
      return () => ipcRenderer.removeListener('repos:changed', listener)
    }
  } satisfies PreloadApi['repos'],

  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    update: (args) => ipcRenderer.invoke('projects:update', args),
    listHostSetups: () => ipcRenderer.invoke('projectHostSetups:list'),
    createHostSetup: (args) => ipcRenderer.invoke('projectHostSetups:create', args),
    setupExistingFolder: (args) =>
      ipcRenderer.invoke('projectHostSetups:setupExistingFolder', args),
    updateHostSetup: (args) => ipcRenderer.invoke('projectHostSetups:update', args),
    deleteHostSetup: (args) => ipcRenderer.invoke('projectHostSetups:delete', args)
  } satisfies PreloadApi['projects'],

  projectGroups: {
    list: () => ipcRenderer.invoke('projectGroups:list'),
    create: (args) => ipcRenderer.invoke('projectGroups:create', args),
    update: (args) => ipcRenderer.invoke('projectGroups:update', args),
    delete: (args) => ipcRenderer.invoke('projectGroups:delete', args),
    moveProject: (args) => ipcRenderer.invoke('projectGroups:moveProject', args),
    scanNested: (args) => ipcRenderer.invoke('projectGroups:scanNested', args),
    cancelNestedScan: (args) => ipcRenderer.invoke('projectGroups:cancelNestedScan', args),
    onNestedScanProgress: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { scanId: string; scan: NestedRepoScanResult }
      ) => callback(data)
      ipcRenderer.on('projectGroups:scanNestedProgress', listener)
      return () => ipcRenderer.removeListener('projectGroups:scanNestedProgress', listener)
    },
    importNested: (args) => ipcRenderer.invoke('projectGroups:importNested', args)
  } satisfies PreloadApi['projectGroups'],

  folderWorkspaces: {
    list: () => ipcRenderer.invoke('folderWorkspaces:list'),
    getPathStatus: (args) => ipcRenderer.invoke('folderWorkspaces:getPathStatus', args),
    create: (args) => ipcRenderer.invoke('folderWorkspaces:create', args),
    update: (args) => ipcRenderer.invoke('folderWorkspaces:update', args),
    delete: (args) => ipcRenderer.invoke('folderWorkspaces:delete', args)
  } satisfies PreloadApi['folderWorkspaces'],

  sparsePresets: {
    list: (args) => ipcRenderer.invoke('sparsePresets:list', args),

    save: (args) => ipcRenderer.invoke('sparsePresets:save', args),

    remove: (args) => ipcRenderer.invoke('sparsePresets:remove', args),

    onChanged: (callback: (data: { repoId: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { repoId: string }) =>
        callback(data)
      ipcRenderer.on('sparsePresets:changed', listener)
      return () => ipcRenderer.removeListener('sparsePresets:changed', listener)
    }
  } satisfies PreloadApi['sparsePresets'],

  worktrees: {
    list: (args) => ipcRenderer.invoke('worktrees:list', args),

    listDetected: (args) => ipcRenderer.invoke('worktrees:listDetected', args),

    cancelListDetected: (args) => ipcRenderer.invoke('worktrees:cancelListDetected', args),

    listAll: () => ipcRenderer.invoke('worktrees:listAll'),

    create: (args) => ipcRenderer.invoke('worktrees:create', args),

    onCreateProgress: (
      callback: (data: { creationId?: string; phase: 'fetching' | 'creating' }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { creationId?: string; phase: 'fetching' | 'creating' }
      ) => callback(data)
      ipcRenderer.on('createWorktree:progress', listener)
      return () => ipcRenderer.removeListener('createWorktree:progress', listener)
    },

    prefetchCreateBase: (args) => ipcRenderer.invoke('worktrees:prefetchCreateBase', args),

    resolvePrBase: (args) => ipcRenderer.invoke('worktrees:resolvePrBase', args),

    remove: (args) => ipcRenderer.invoke('worktrees:remove', args),

    forgetLocal: (args) => ipcRenderer.invoke('worktrees:forgetLocal', args),

    forceDeletePreservedBranch: (args) =>
      ipcRenderer.invoke('worktrees:forceDeletePreservedBranch', args),

    updateMeta: (args) => ipcRenderer.invoke('worktrees:updateMeta', args),

    listLineage: () => ipcRenderer.invoke('worktrees:listLineage'),

    listLineageForHost: (args: ListDesktopLineageForHostArgs): Promise<HostLineageSnapshot> =>
      ipcRenderer.invoke('worktrees:listLineageForHost', args),

    updateLineage: (args) => ipcRenderer.invoke('worktrees:updateLineage', args),

    persistSortOrder: (args) => ipcRenderer.invoke('worktrees:persistSortOrder', args),

    getBranchRenameFailureOutput: (args) =>
      ipcRenderer.invoke('worktrees:getBranchRenameFailureOutput', args),

    onChanged: (
      callback: (data: {
        repoId: string
        renamed?: { oldWorktreeId: string; newWorktreeId: string }
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { repoId: string; renamed?: { oldWorktreeId: string; newWorktreeId: string } }
      ) => callback(data)
      ipcRenderer.on('worktrees:changed', listener)
      return () => ipcRenderer.removeListener('worktrees:changed', listener)
    },

    onGitStatusMetadataChanged: (callback: (data: { repoId: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { repoId: string }) =>
        callback(data)
      ipcRenderer.on('worktrees:gitStatusMetadataChanged', listener)
      return () => ipcRenderer.removeListener('worktrees:gitStatusMetadataChanged', listener)
    },

    onHeadIdentitiesChanged: (
      callback: (data: { repoId: string; identities: WorktreeHeadIdentity[] }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { repoId: string; identities: WorktreeHeadIdentity[] }
      ) => callback(data)
      ipcRenderer.on('worktrees:headIdentitiesChanged', listener)
      return () => ipcRenderer.removeListener('worktrees:headIdentitiesChanged', listener)
    },

    onBaseStatus: (callback: (data: WorktreeBaseStatusEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: WorktreeBaseStatusEvent) =>
        callback(data)
      ipcRenderer.on('worktree:baseStatus', listener)
      return () => ipcRenderer.removeListener('worktree:baseStatus', listener)
    },

    onRemoteBranchConflict: (
      callback: (data: WorktreeRemoteBranchConflictEvent) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: WorktreeRemoteBranchConflictEvent
      ) => callback(data)
      ipcRenderer.on('worktree:remoteBranchConflict', listener)
      return () => ipcRenderer.removeListener('worktree:remoteBranchConflict', listener)
    }
  } satisfies PreloadApi['worktrees'],

  workspaceCleanup: {
    scan: (args, onProgress) => {
      if (!onProgress) {
        return ipcRenderer.invoke('workspaceCleanup:scan', args)
      }
      const scanId = args?.scanId ?? crypto.randomUUID()
      const listener = (
        _event: Electron.IpcRendererEvent,
        progress: WorkspaceCleanupScanProgress
      ): void => {
        if (progress.scanId === scanId) {
          onProgress(progress)
        }
      }
      ipcRenderer.on('workspaceCleanup:scanProgress', listener)
      return ipcRenderer
        .invoke('workspaceCleanup:scan', { ...args, scanId })
        .finally(() => ipcRenderer.removeListener('workspaceCleanup:scanProgress', listener))
    },
    dismiss: (args) => ipcRenderer.invoke('workspaceCleanup:dismiss', args),
    clearDismissals: () => ipcRenderer.invoke('workspaceCleanup:clearDismissals'),
    hasKillableLocalProcesses: (args) =>
      ipcRenderer.invoke('workspaceCleanup:hasKillableLocalProcesses', args)
  } satisfies PreloadApi['workspaceCleanup'],

  workspaceSpace: {
    analyze: () => ipcRenderer.invoke('workspaceSpace:analyze'),
    cancel: () => ipcRenderer.invoke('workspaceSpace:cancel'),
    onProgress: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        progress: WorkspaceSpaceScanProgress
      ): void => callback(progress)
      ipcRenderer.on('workspaceSpace:progress', listener)
      return () => ipcRenderer.removeListener('workspaceSpace:progress', listener)
    }
  } satisfies PreloadApi['workspaceSpace'],

  workspacePorts: {
    scan: (args) => ipcRenderer.invoke('workspacePorts:scan', args),
    kill: (args) => ipcRenderer.invoke('workspacePorts:kill', args),
    onAdvertisedUrlChanged: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        event: WorkspacePortAdvertisedUrlChangedEvent
      ): void => callback(event)
      ipcRenderer.on('workspacePorts:advertised-url-changed', listener)
      return () => ipcRenderer.removeListener('workspacePorts:advertised-url-changed', listener)
    }
  } satisfies PreloadApi['workspacePorts'],

  pty: {
    spawn: (opts: {
      cols: number
      rows: number
      cwd?: string
      cwdFallback?: 'worktree'
      env?: Record<string, string>
      envToDelete?: string[]
      command?: string
      launchConfig?: SleepingAgentLaunchConfig
      resumeProviderSession?: AgentProviderSessionMetadata
      launchToken?: string
      launchAgent?: TuiAgent
      startupCommandDelivery?: StartupCommandDelivery
      connectionId?: string | null
      worktreeId?: string
      sessionId?: string
      shellOverride?: string
      projectRuntime?: ProjectExecutionRuntimeResolution
      terminalColorQueryReplies?: { foreground?: string; background?: string }
      // Why: marks the PTY hidden before its first byte so the delivery gate + model responder own spawn-time queries (terminal-query-authority.md §races).
      initiallyHidden?: boolean
      // Why: closes the SIGKILL race (INVESTIGATION.md) — main sync-flushes the (worktreeId, tabId, leafId → ptyId) binding before pty:spawn returns.
      tabId?: string
      leafId?: string
      // Why: loose typing on purpose — renderer owns launch metadata, main owns whether the launch happened and validates (telemetry-plan.md §Agent launch semantics).
      telemetry?: { agent_kind: AgentKind; launch_source: LaunchSource; request_kind: RequestKind }
    }): Promise<{
      id: string
      launchConfig?: SleepingAgentLaunchConfig
      snapshot?: string
      snapshotCols?: number
      snapshotRows?: number
      isReattach?: boolean
      isAlternateScreen?: boolean
      replay?: string
      sessionExpired?: boolean
      coldRestore?: { scrollback: string; cwd: string; cols?: number; rows?: number }
      startupCwdFallback?: { kind: 'worktree'; cwd: string }
      agentResumeUnavailable?: true
    }> => ipcRenderer.invoke('pty:spawn', opts),

    write: (id: string, data: string): void => {
      ipcRenderer.send('pty:write', { id, data })
    },
    writeAccepted: (id: string, data: string): Promise<boolean> =>
      ipcRenderer.invoke('pty:writeAccepted', { id, data }),
    onWriteUnavailable: (callback: (payload: { id: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { id: string }): void =>
        callback(payload)
      ipcRenderer.on('pty:writeUnavailable', handler)
      return () => ipcRenderer.removeListener('pty:writeUnavailable', handler)
    },

    resize: (id: string, cols: number, rows: number): void => {
      ipcRenderer.send('pty:resize', { id, cols, rows })
    },
    claimViewport: (id: string, cols: number, rows: number): void => {
      ipcRenderer.send('pty:claimViewport', { id, cols, rows })
    },

    /** Why: measurement-only sibling of resize — keeps the runtime's restore-target baseline fresh while a mobile-fit override blocks pty:resize. Never resizes the PTY. See docs/mobile-fit-hold.md. */
    reportGeometry: (id: string, cols: number, rows: number): void => {
      ipcRenderer.send('pty:reportGeometry', { id, cols, rows })
    },

    signal: (id: string, signal: string): void => {
      ipcRenderer.send('pty:signal', { id, signal })
    },

    /** Why: Cmd/Ctrl+K clears the renderer xterm, but the PTY host keeps its own screen state and would repaint the next prompt at the stale cursor row. */
    clearBuffer: (id: string): void => {
      ipcRenderer.send('pty:clearBuffer', { id })
    },

    ackColdRestore: (id: string): void => {
      ipcRenderer.send('pty:ackColdRestore', { id })
    },
    /** charCount is the legacy per-chunk delta; processedChars is the cumulative per-pty total (self-heals under lost ACKs). */
    ackData: (id: string, charCount: number, processedChars?: number): void => {
      ipcRenderer.send('pty:ackData', {
        id,
        charCount,
        ...(typeof processedChars === 'number' ? { processedChars } : {})
      })
    },
    /** Main requests the renderer's cumulative processed totals when delivery looks stuck on lost ACKs. */
    onDeliveryResyncRequest: (callback: (payload: { requestId: number }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { requestId: number }) =>
        callback(payload)
      ipcRenderer.on('pty:requestDeliveryResync', listener)
      return () => ipcRenderer.removeListener('pty:requestDeliveryResync', listener)
    },
    respondDeliveryResync: (payload: {
      requestId: number
      processedCharsByPty: Record<string, number>
    }): void => {
      ipcRenderer.send('pty:deliveryResyncResponse', payload)
    },
    /** Renderer-initiated delivery health/heal lane — rides invoke because the field wedge (v1.4.121-rc.0) kills main→renderer push while invoke stays alive. */
    reportRendererDeliveryState: (
      report: PtyRendererDeliveryStateReport
    ): Promise<PtyRendererDeliveryHealthReply> =>
      ipcRenderer.invoke('pty:reportRendererDeliveryState', report),
    /** Live pty:data listener count — the watchdog's "listener detached" vs "channel dead" discriminator. */
    getPtyDataListenerCount: (): number => ipcRenderer.listenerCount('pty:data'),
    rendererDispatcherReady: (): void => {
      ipcRenderer.send('pty:rendererDispatcherReady')
    },
    setActiveRendererPty: (id: string, active: boolean): void => {
      ipcRenderer.send('pty:setActiveRendererPty', { id, active })
    },
    setRendererPtyVisible: (id: string, visible: boolean): void => {
      ipcRenderer.send('pty:setRendererPtyVisible', { id, visible })
    },
    /** Hidden-delivery gate: hidden=true lets main DROP renderer byte delivery after model ingestion; reveal restores from the model snapshot. Fire-and-forget. */
    setHiddenRendererPty: (id: string, hidden: boolean): void => {
      ipcRenderer.send('pty:setHiddenRendererPty', { id, hidden })
    },
    /** Delivery-interest signal: a renderer party needing raw bytes suppresses the hidden-delivery gate for that PTY while registered. */
    setPtyDeliveryInterest: (id: string, interested: boolean): void => {
      ipcRenderer.send('pty:setPtyDeliveryInterest', { id, interested })
    },
    /** Push composed terminal appearance so main's model responder can answer OSC 4/10/11/12 and DSR ?996n for hidden-gated PTYs with renderer-true values. */
    publishTerminalViewAttributes: (attributes: TerminalViewAttributes): void => {
      ipcRenderer.send('pty:terminalViewAttributes', attributes)
    },

    kill: (id: string, opts?: { keepHistory?: boolean }): Promise<void> =>
      ipcRenderer.invoke('pty:kill', { id, keepHistory: opts?.keepHistory ?? false }),

    listSessions: (): Promise<PtyListedSession[]> => ipcRenderer.invoke('pty:listSessions'),
    getAuthoritativeBufferSnapshotCapabilities: (
      ids: string[]
    ): Promise<{ id: string; authoritative: boolean | null }[]> =>
      ipcRenderer.invoke('pty:getAuthoritativeBufferSnapshotCapabilities', { ids }),
    hasPty: (id: string): Promise<boolean | null> => ipcRenderer.invoke('pty:hasPty', { id }),

    getMainBufferSnapshot: (
      id: string,
      opts?: { scrollbackRows?: number }
    ): Promise<{
      data: string
      cols: number
      rows: number
      cwd?: string | null
      seq?: number
      pendingDeliveryStartSeq?: number
      source?: 'headless' | 'renderer'
      alternateScreen?: boolean
      scrollbackAnsi?: string
      pendingEscapeTailAnsi?: string
    } | null> => ipcRenderer.invoke('pty:getMainBufferSnapshot', { id, opts }),

    getRendererDeliveryDebugSnapshot: (): Promise<{
      pendingPtyCount: number
      pendingChars: number
      maxPendingCharsByPty: number
      rendererInFlightPtyCount: number
      rendererInFlightChars: number
      maxRendererInFlightCharsByPty: number
      activeRendererPtyCount: number
      flushScheduled: boolean
      peakPendingChars: number
      peakMaxPendingCharsByPty: number
      peakRendererInFlightChars: number
      peakMaxRendererInFlightCharsByPty: number
      ackGatedFlushSkipCount: number
      hiddenDeliveryGatedPtyCount: number
      hiddenDeliveryGatedVisiblePtyCount: number
      hiddenDeliveryGatedActivePtyCount: number
      deliveryInterestPtyCount: number
      hiddenDeliveryDroppedChars: number
      hiddenDeliveryDroppedChunks: number
      pendingDroppedChars: number
      diagnostics: PtyMainDeliveryDiagnostics
      rendererLifecycleResetCount: number
      lastLifecycleResetClearedChars: number
      rendererPtyDispatcherReady: boolean
      rendererDispatcherReadyForcedCount: number
    }> => ipcRenderer.invoke('pty:getRendererDeliveryDebugSnapshot'),

    resetRendererDeliveryDebug: (): Promise<void> =>
      ipcRenderer.invoke('pty:resetRendererDeliveryDebug'),

    /** True if the PTY's shell has child processes (a running command); false at an idle prompt. */
    hasChildProcesses: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('pty:hasChildProcesses', { id }),

    /** Return the PTY foreground process basename when available (e.g. "codex"). */
    getForegroundProcess: (id: string): Promise<string | null> =>
      ipcRenderer.invoke('pty:getForegroundProcess', { id }),
    inspectProcess: (
      id: string
    ): Promise<{
      foregroundProcess: string | null
      hasChildProcesses: boolean
      unavailable?: true
    }> => ipcRenderer.invoke('pty:inspectProcess', { id }),
    confirmForegroundProcess: (id: string): Promise<string | null> =>
      ipcRenderer.invoke('pty:confirmForegroundProcess', { id }),

    /** Resolve a PTY's live cwd via `/proc` (Linux) or `lsof` (macOS); `''` when unknown or unresolvable. */
    getCwd: (id: string): Promise<string> => ipcRenderer.invoke('pty:getCwd', { id }),

    /** The PTY's last APPLIED size (real winsize), or null if unknown — lets the renderer detect drift after a dropped resize and re-assert. */
    getSize: (id: string): Promise<{ cols: number; rows: number } | null> =>
      ipcRenderer.invoke('pty:getSize', { id }),

    onData: (
      callback: (data: {
        id: string
        data: string
        seq?: number
        rawLength?: number
        transformed?: boolean
        background?: boolean
        droppedOutput?: boolean
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          id: string
          data: string
          seq?: number
          rawLength?: number
          transformed?: boolean
          background?: boolean
          droppedOutput?: boolean
        }
      ) => callback(data)
      ipcRenderer.on('pty:data', listener)
      return () => ipcRenderer.removeListener('pty:data', listener)
    },

    onReplay: (callback: (data: { id: string; data: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { id: string; data: string }) =>
        callback(data)
      ipcRenderer.on('pty:replay', listener)
      return () => ipcRenderer.removeListener('pty:replay', listener)
    },

    /** Out-of-band signal that main dropped renderer-bound bytes (hidden-gate / pending cap); pane restores from the model snapshot.
     *  NOT on pty:data — an in-band marker is ambiguous with chunks fully stripped by OSC-9999 cleaning. */
    onModelRestoreNeeded: (callback: (event: PtyModelRestoreNeededEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, event: PtyModelRestoreNeededEvent) =>
        callback(event)
      ipcRenderer.on('pty:modelRestoreNeeded', listener)
      return () => ipcRenderer.removeListener('pty:modelRestoreNeeded', listener)
    },

    /** Batched side-effect facts (title/bell/agent transitions) for local-main PTYs.
     *  Per-PTY in-order; deliberately NOT synced with pty:data (terminal-side-effect-authority.md). */
    onSideEffect: (callback: (batch: TerminalSideEffectBatch) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, batch: TerminalSideEffectBatch) =>
        callback(batch)
      ipcRenderer.on('pty:sideEffect', listener)
      return () => ipcRenderer.removeListener('pty:sideEffect', listener)
    },

    /** Title-only replay snapshot on (re)attach — attention facts (bells/completions) never replay. */
    getSideEffectSnapshot: (id: string): Promise<TerminalSideEffectBatch | null> =>
      ipcRenderer.invoke('pty:sideEffectSnapshot', { id }),

    onExit: (
      callback: (data: { id: string; code: number; preserveRendererBinding?: boolean }) => void
    ): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { id: string; code: number }) =>
        callback(data)
      ipcRenderer.on('pty:exit', listener)
      return () => ipcRenderer.removeListener('pty:exit', listener)
    },

    onSpawned: (callback: (data: { id: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { id: string }) => callback(data)
      ipcRenderer.on('pty:spawned', listener)
      return () => ipcRenderer.removeListener('pty:spawned', listener)
    },

    onSerializeBufferRequest: (
      callback: (data: {
        requestId: string
        ptyId: string
        opts?: { scrollbackRows?: number; altScreenForcesZeroRows?: boolean }
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          requestId: string
          ptyId: string
          opts?: { scrollbackRows?: number; altScreenForcesZeroRows?: boolean }
        }
      ) => callback(data)
      ipcRenderer.on('pty:serializeBuffer:request', listener)
      return () => ipcRenderer.removeListener('pty:serializeBuffer:request', listener)
    },

    onClearBufferRequest: (callback: (data: { ptyId: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { ptyId: string }) =>
        callback(data)
      ipcRenderer.on('pty:clearBuffer:request', listener)
      return () => ipcRenderer.removeListener('pty:clearBuffer:request', listener)
    },

    sendSerializedBuffer: (
      requestId: string,
      snapshot: {
        data: string
        cols: number
        rows: number
        seq?: number
        lastTitle?: string
      } | null
    ): void => {
      ipcRenderer.send('pty:serializeBuffer:response', { requestId, snapshot })
    },

    // Claim serializer ownership before spawn; echo the generation token on settle/clear to prevent pane-key reuse races.
    declarePendingPaneSerializer: (paneKey: string): Promise<number> =>
      ipcRenderer.invoke('pty:declarePendingPaneSerializer', { paneKey }),

    settlePaneSerializer: (paneKey: string, gen: number): Promise<void> =>
      ipcRenderer.invoke('pty:settlePaneSerializer', { paneKey, gen }),

    clearPendingPaneSerializer: (paneKey: string, gen: number): Promise<void> =>
      ipcRenderer.invoke('pty:clearPendingPaneSerializer', { paneKey, gen }),

    reportRendererSerializerReady: (ptyId: string): Promise<void> =>
      ipcRenderer.invoke('pty:reportRendererSerializerReady', { ptyId }),

    management: {
      listSessions: () => ipcRenderer.invoke('pty:management:listSessions'),
      killAll: () => ipcRenderer.invoke('pty:management:killAll'),
      killOne: (args: { sessionId: string }) => ipcRenderer.invoke('pty:management:killOne', args),
      restart: () => ipcRenderer.invoke('pty:management:restart'),
      macTccAttribution: () => ipcRenderer.invoke('pty:management:macTccAttribution')
    }
  },

  feedback: {
    submit: (args: {
      feedback: string
      submitAnonymously?: boolean
      githubLogin: string | null
      githubEmail: string | null
      images?: { contentType: string; data: Uint8Array }[]
    }): Promise<
      { ok: true; imagesDelivered?: boolean } | { ok: false; status: number | null; error: string }
    > => ipcRenderer.invoke('feedback:submit', args)
  },

  crashReports: {
    getLatestPending: () => ipcRenderer.invoke('crashReports:getLatestPending'),
    getLatestReport: () => ipcRenderer.invoke('crashReports:getLatestReport'),
    dismiss: (args: { reportId: string }) => ipcRenderer.invoke('crashReports:dismiss', args),
    recordRendererError: (
      args: ReactErrorBoundaryReportArgs
    ): Promise<ReactErrorBoundaryReportResult> =>
      ipcRenderer.invoke('crashReports:recordRendererError', args),
    recordBreadcrumb: (args: { name: string; data?: CrashReportBreadcrumbData }): void =>
      ipcRenderer.send('crashReports:recordBreadcrumb', args),
    submit: (args: CrashReportSubmitArgs): Promise<CrashReportSubmitResult> =>
      ipcRenderer.invoke('crashReports:submit', args),
    copyLatestDiagnostics: (args?: CrashReportCopyDiagnosticsArgs) =>
      ipcRenderer.invoke('crashReports:copyLatestDiagnostics', args),
    readHeapStatistics: (): RendererHeapStatistics | null => readRendererHeapStatistics()
  },

  export: {
    htmlToPdf: (args: {
      html: string
      title: string
    }): Promise<
      { success: true; filePath: string } | { success: false; cancelled?: boolean; error?: string }
    > => ipcRenderer.invoke('export:html-to-pdf', args)
  },

  gh: {
    viewer: (): Promise<unknown> => ipcRenderer.invoke('gh:viewer'),

    repoSlug: (args: { repoPath: string; repoId?: string }): Promise<unknown> =>
      ipcRenderer.invoke('gh:repoSlug', args),

    repoUpstream: (args: { repoPath: string; repoId?: string }): Promise<unknown> =>
      ipcRenderer.invoke('gh:repoUpstream', args),

    prForBranch: (args: {
      repoPath: string
      repoId?: string
      branch: string
      linkedPRNumber?: number | null
      fallbackPRNumber?: number | null
      acceptMergedFallbackPR?: boolean
      currentHeadOid?: string | null
    }): Promise<unknown> => ipcRenderer.invoke('gh:prForBranch', args),

    refreshPRNow: (args: { candidate: GitHubPRRefreshCandidate }): Promise<unknown> =>
      ipcRenderer.invoke('gh:refreshPRNow', args),

    enqueuePRRefresh: (args: {
      candidate: GitHubPRRefreshCandidate
      reason: GitHubPRRefreshReason
      priority?: number
    }): Promise<unknown> => ipcRenderer.invoke('gh:enqueuePRRefresh', args),

    reportVisiblePRRefreshCandidates: (args: {
      candidates: GitHubPRRefreshCandidate[]
      generation: number
    }): Promise<unknown> => ipcRenderer.invoke('gh:reportVisiblePRRefreshCandidates', args),

    onPRRefreshEvent: (callback: (event: GitHubPRRefreshEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, event: GitHubPRRefreshEvent): void =>
        callback(event)
      ipcRenderer.on('gh:prRefreshEvent', listener)
      return () => ipcRenderer.removeListener('gh:prRefreshEvent', listener)
    },

    issue: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      number: number
    }): Promise<unknown> => ipcRenderer.invoke('gh:issue', args),

    workItem: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      number: number
      type?: 'issue' | 'pr'
    }): Promise<unknown> => ipcRenderer.invoke('gh:workItem', args),

    workItemByOwnerRepo: (args: {
      repoPath: string
      repoId?: string
      owner: string
      repo: string
      host?: string
      number: number
      type: 'issue' | 'pr'
    }): Promise<unknown> => ipcRenderer.invoke('gh:workItemByOwnerRepo', args),

    workItemDetails: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      number: number
      type?: 'issue' | 'pr'
    }): Promise<unknown> => ipcRenderer.invoke('gh:workItemDetails', args),

    notifyWorkItemMutated: (args: {
      repoPath: string
      repoId?: string
      type: 'issue' | 'pr'
      number: number
    }): Promise<boolean> => ipcRenderer.invoke('gh:notifyWorkItemMutated', args),

    prFileContents: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      prNumber: number
      prRepo?: GitHubOwnerRepo | null
      path: string
      oldPath?: string
      status: string
      headSha: string
      baseSha: string
    }): Promise<unknown> => ipcRenderer.invoke('gh:prFileContents', args),

    listIssues: (args: { repoPath: string; repoId?: string; limit?: number }): Promise<unknown[]> =>
      ipcRenderer.invoke('gh:listIssues', args),

    createIssue: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      title: string
      body: string
      labels?: string[]
      assignees?: string[]
    }): Promise<GitHubCreateIssueResult> => ipcRenderer.invoke('gh:createIssue', args),

    countWorkItems: (args: {
      repoPath: string
      repoId?: string
      query?: string
    }): Promise<number> => ipcRenderer.invoke('gh:countWorkItems', args),

    listWorkItems: (args: {
      repoPath: string
      repoId?: string
      limit?: number
      query?: string
      page?: number
      noCache?: boolean
    }): Promise<ListWorkItemsResult<Omit<GitHubWorkItem, 'repoId'>>> =>
      ipcRenderer.invoke('gh:listWorkItems', args),

    prChecks: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      prNumber: number
      headSha?: string
      prRepo?: GitHubOwnerRepo | null
      noCache?: boolean
    }): Promise<unknown[]> => ipcRenderer.invoke('gh:prChecks', args),

    prCheckDetails: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      checkRunId?: number
      workflowRunId?: number
      checkName?: string
      url?: string | null
      prRepo?: GitHubOwnerRepo | null
    }): Promise<unknown | null> => ipcRenderer.invoke('gh:prCheckDetails', args),

    rerunPRChecks: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      prNumber: number
      headSha?: string
      failedOnly?: boolean
      prRepo?: GitHubOwnerRepo | null
    }): Promise<{ ok: true; count: number } | { ok: false; error: string }> =>
      ipcRenderer.invoke('gh:rerunPRChecks', args),

    prComments: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      prNumber: number
      prRepo?: GitHubOwnerRepo | null
      noCache?: boolean
    }): Promise<unknown[]> => ipcRenderer.invoke('gh:prComments', args),

    resolveReviewThread: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      threadId: string
      resolve: boolean
      prRepo?: GitHubOwnerRepo | null
    }): Promise<boolean> => ipcRenderer.invoke('gh:resolveReviewThread', args),

    setPRFileViewed: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      prNumber: number
      prRepo?: GitHubOwnerRepo | null
      pullRequestId: string
      path: string
      viewed: boolean
    }): Promise<boolean> => ipcRenderer.invoke('gh:setPRFileViewed', args),

    updatePRTitle: (args: {
      repoPath: string
      repoId?: string
      prNumber: number
      title: string
      prRepo?: GitHubOwnerRepo | null
    }): Promise<boolean> => ipcRenderer.invoke('gh:updatePRTitle', args),

    mergePR: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      prNumber: number
      method?: 'merge' | 'squash' | 'rebase'
      prRepo?: GitHubOwnerRepo | null
    }): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('gh:mergePR', args),

    setPRAutoMerge: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      prNumber: number
      enabled: boolean
      method?: 'merge' | 'squash' | 'rebase'
      prRepo?: GitHubOwnerRepo | null
    }): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('gh:setPRAutoMerge', args),

    updatePRState: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      prNumber: number
      updates: { state: 'open' | 'closed' }
      prRepo?: GitHubOwnerRepo | null
    }): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('gh:updatePRState', args),

    requestPRReviewers: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      prNumber: number
      reviewers: string[]
      prRepo?: GitHubOwnerRepo | null
    }): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('gh:requestPRReviewers', args),

    removePRReviewers: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      prNumber: number
      reviewers: string[]
      prRepo?: GitHubOwnerRepo | null
    }): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('gh:removePRReviewers', args),

    updateIssue: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      number: number
      updates: unknown
    }): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('gh:updateIssue', args),

    addIssueComment: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      number: number
      body: string
      type?: 'issue' | 'pr'
      prRepo?: GitHubOwnerRepo | null
    }): Promise<GitHubCommentResult> => ipcRenderer.invoke('gh:addIssueComment', args),

    addPRReviewCommentReply: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      prNumber: number
      commentId: number
      body: string
      threadId?: string
      path?: string
      line?: number
      prRepo?: GitHubOwnerRepo | null
    }): Promise<GitHubCommentResult> => ipcRenderer.invoke('gh:addPRReviewCommentReply', args),

    addPRReviewComment: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      prNumber: number
      prRepo?: GitHubOwnerRepo | null
      commitId: string
      path: string
      line: number
      startLine?: number
      body: string
    }): Promise<GitHubCommentResult> => ipcRenderer.invoke('gh:addPRReviewComment', args),

    listLabels: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
    }): Promise<string[]> => ipcRenderer.invoke('gh:listLabels', args),

    listAssignableUsers: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
    }): Promise<GitHubAssignableUser[]> => ipcRenderer.invoke('gh:listAssignableUsers', args),

    // Why: renderer owns the work-item cache; main fires this for non-origin mutations only (origin callers updated optimistically). See src/main/ipc/github.ts.
    onWorkItemMutated: (
      callback: (payload: {
        repoPath: string
        repoId?: string
        type: 'issue' | 'pr'
        number: number
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { repoPath: string; repoId?: string; type: 'issue' | 'pr'; number: number }
      ): void => callback(payload)
      ipcRenderer.on('gh:workItemMutated', listener)
      return () => ipcRenderer.removeListener('gh:workItemMutated', listener)
    },

    checkOrcaStarred: (): Promise<boolean | null> => ipcRenderer.invoke('gh:checkOrcaStarred'),
    starOrca: (source: AppStarSource): Promise<boolean> =>
      ipcRenderer.invoke('gh:starOrca', source),

    // Why: rate_limit is exempt from rate-limit accounting; `force` still busts the 30s in-process cache after an expensive op.
    rateLimit: (args?: { force?: boolean }): Promise<GetRateLimitResult> =>
      ipcRenderer.invoke('gh:rateLimit', args),

    diagnoseAuth: (args?: { host?: string }): Promise<GhAuthDiagnostic> =>
      ipcRenderer.invoke('gh:diagnoseAuth', args),

    // ── ProjectV2 (GitHub Projects) ───────────────────────────────────
    listAccessibleProjects: (
      args?: ListAccessibleProjectsArgs
    ): Promise<ListAccessibleProjectsResult> =>
      ipcRenderer.invoke('gh:listAccessibleProjects', args),
    resolveProjectRef: (args: ResolveProjectRefArgs): Promise<ResolveProjectRefResult> =>
      ipcRenderer.invoke('gh:resolveProjectRef', args),
    listProjectViews: (args: ListProjectViewsArgs): Promise<ListProjectViewsResult> =>
      ipcRenderer.invoke('gh:listProjectViews', args),
    getProjectViewTable: (args: GetProjectViewTableArgs): Promise<GetProjectViewTableResult> =>
      ipcRenderer.invoke('gh:getProjectViewTable', args),
    projectWorkItemDetailsBySlug: (
      args: ProjectWorkItemDetailsBySlugArgs
    ): Promise<ProjectWorkItemDetailsBySlugResult> =>
      ipcRenderer.invoke('gh:projectWorkItemDetailsBySlug', args),
    updateProjectItemField: (
      args: UpdateProjectItemFieldArgs
    ): Promise<GitHubProjectMutationResult> =>
      ipcRenderer.invoke('gh:updateProjectItemField', args),
    clearProjectItemField: (
      args: ClearProjectItemFieldArgs
    ): Promise<GitHubProjectMutationResult> => ipcRenderer.invoke('gh:clearProjectItemField', args),
    updateIssueBySlug: (args: UpdateIssueBySlugArgs): Promise<GitHubProjectMutationResult> =>
      ipcRenderer.invoke('gh:updateIssueBySlug', args),
    updatePullRequestBySlug: (
      args: UpdatePullRequestBySlugArgs
    ): Promise<GitHubProjectMutationResult> =>
      ipcRenderer.invoke('gh:updatePullRequestBySlug', args),
    addIssueCommentBySlug: (
      args: AddIssueCommentBySlugArgs
    ): Promise<GitHubProjectCommentMutationResult> =>
      ipcRenderer.invoke('gh:addIssueCommentBySlug', args),
    updateIssueCommentBySlug: (
      args: UpdateIssueCommentBySlugArgs
    ): Promise<GitHubProjectMutationResult> =>
      ipcRenderer.invoke('gh:updateIssueCommentBySlug', args),
    deleteIssueCommentBySlug: (
      args: DeleteIssueCommentBySlugArgs
    ): Promise<GitHubProjectMutationResult> =>
      ipcRenderer.invoke('gh:deleteIssueCommentBySlug', args),
    listLabelsBySlug: (args: ListLabelsBySlugArgs): Promise<ListLabelsBySlugResult> =>
      ipcRenderer.invoke('gh:listLabelsBySlug', args),
    listAssignableUsersBySlug: (
      args: ListAssignableUsersBySlugArgs
    ): Promise<ListAssignableUsersBySlugResult> =>
      ipcRenderer.invoke('gh:listAssignableUsersBySlug', args),
    listIssueTypesBySlug: (args: ListIssueTypesBySlugArgs): Promise<ListIssueTypesBySlugResult> =>
      ipcRenderer.invoke('gh:listIssueTypesBySlug', args),
    updateIssueTypeBySlug: (
      args: UpdateIssueTypeBySlugArgs
    ): Promise<GitHubProjectMutationResult> => ipcRenderer.invoke('gh:updateIssueTypeBySlug', args)
  },

  hostedReview: {
    forBranch: (args: HostedReviewForBranchArgs): Promise<unknown> =>
      ipcRenderer.invoke('hostedReview:forBranch', args),
    getCreationEligibility: (args: unknown): Promise<unknown> =>
      ipcRenderer.invoke('hostedReview:getCreationEligibility', args),
    create: (args: unknown): Promise<unknown> => ipcRenderer.invoke('hostedReview:create', args)
  },

  starNag: {
    onShow: (
      callback: (payload?: { mode?: 'gh' | 'web'; surface?: 'card' | 'toast' }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload?: { mode?: 'gh' | 'web'; surface?: 'card' | 'toast' }
      ): void => callback(payload)
      ipcRenderer.on('star-nag:show', listener)
      return () => ipcRenderer.removeListener('star-nag:show', listener)
    },
    onHide: (callback: () => void): (() => void) => {
      const listener = (): void => callback()
      ipcRenderer.on('star-nag:hide', listener)
      return () => ipcRenderer.removeListener('star-nag:hide', listener)
    },
    dismiss: (): Promise<void> => ipcRenderer.invoke('star-nag:dismiss'),
    later: (): Promise<void> => ipcRenderer.invoke('star-nag:later'),
    complete: (): Promise<void> => ipcRenderer.invoke('star-nag:complete'),
    disable: (): Promise<void> => ipcRenderer.invoke('star-nag:disable'),
    openWeb: (): Promise<void> => ipcRenderer.invoke('star-nag:openWeb'),
    starOrca: (): Promise<boolean> => ipcRenderer.invoke('star-nag:starOrca'),
    forceShow: (): Promise<void> => ipcRenderer.invoke('star-nag:forceShow'),
    agentValueMoment: (): Promise<
      { status: 'ready'; mode: 'gh' | 'web' } | { status: 'skipped' }
    > => ipcRenderer.invoke('star-nag:agentValueMoment'),
    showAgentValueMoment: (): Promise<void> => ipcRenderer.invoke('star-nag:showAgentValueMoment'),
    onboardingCompleted: (): Promise<void> => ipcRenderer.invoke('star-nag:onboardingCompleted')
  },

  // Why: main validates telemetry; renderer call sites use typed wrappers.
  telemetryTrack: (name: string, props: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke('telemetry:track', name, props),
  telemetrySetOptIn: (optedIn: boolean): Promise<void> =>
    ipcRenderer.invoke('telemetry:setOptIn', optedIn),
  telemetryAcknowledgeBanner: (): Promise<void> =>
    ipcRenderer.invoke('telemetry:acknowledgeBanner'),
  telemetryGetConsentState: (): Promise<TelemetryConsentState> =>
    ipcRenderer.invoke('telemetry:getConsentState'),

  // Why: bridges are deliberately loose — main type-narrows this untrusted renderer input (see telemetry-error-tracking.md).
  diagnostics: {
    getStatus: (): Promise<unknown> => ipcRenderer.invoke('diagnostics:getStatus'),
    collectBundle: (lookbackMinutes?: number): Promise<unknown> =>
      ipcRenderer.invoke('diagnostics:collectBundle', lookbackMinutes),
    openBundlePreview: (bundleSubmissionId: string): Promise<void> =>
      ipcRenderer.invoke('diagnostics:openBundlePreview', bundleSubmissionId),
    discardBundlePreview: (bundleSubmissionId: string): Promise<void> =>
      ipcRenderer.invoke('diagnostics:discardBundlePreview', bundleSubmissionId),
    uploadBundle: (bundleSubmissionId: string): Promise<unknown> =>
      ipcRenderer.invoke('diagnostics:uploadBundle', bundleSubmissionId),
    deleteBundle: (ticketId: string): Promise<void> =>
      ipcRenderer.invoke('diagnostics:deleteBundle', ticketId)
  },

  settings: {
    get: (): Promise<unknown> => ipcRenderer.invoke('settings:get'),

    // Why: blocking read for the few startup decisions (terminal side-effect authority) that can't wait for async hydration. Call sparingly.
    getSync: (): unknown => ipcRenderer.sendSync('settings:get-sync'),

    set: (args: Record<string, unknown>): Promise<unknown> =>
      ipcRenderer.invoke('settings:set', args),

    setActiveRuntimeEnvironmentPreference: (args: {
      environmentId: string | null
    }): Promise<unknown> =>
      ipcRenderer.invoke('settings:set-active-runtime-environment-preference', args),

    updatePRBotAuthorOverride: (args: { author: string; isBot: boolean }): Promise<unknown> =>
      ipcRenderer.invoke('settings:update-pr-bot-author-override', args),

    listFonts: (): Promise<string[]> => ipcRenderer.invoke('settings:listFonts'),

    previewGhosttyImport: (): Promise<GhosttyImportPreview> =>
      ipcRenderer.invoke('settings:previewGhosttyImport'),

    previewWarpThemeImport: (source: WarpThemeImportSource): Promise<WarpThemeImportPreview> =>
      ipcRenderer.invoke('settings:previewWarpThemeImport', source),

    onChanged: (callback: (updates: Record<string, unknown>) => void): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        updates: Record<string, unknown>
      ): void => callback(updates)
      ipcRenderer.on('settings:changed', listener)
      return () => ipcRenderer.removeListener('settings:changed', listener)
    }
  },

  localhostWorktreeLabels: {
    register: (args: LocalhostWorktreeLabelRoute): Promise<LocalhostWorktreeLabelResult> =>
      ipcRenderer.invoke('localhostWorktreeLabels:register', args)
  } satisfies PreloadApi['localhostWorktreeLabels'],

  keybindings: {
    get: (): Promise<KeybindingFileSnapshot> => ipcRenderer.invoke('keybindings:get'),
    ensureFile: (): Promise<KeybindingFileSnapshot> => ipcRenderer.invoke('keybindings:ensureFile'),
    setAction: (args: {
      actionId: KeybindingActionId
      bindings: string[] | null
    }): Promise<KeybindingFileSnapshot> => ipcRenderer.invoke('keybindings:setAction', args),
    reload: (): Promise<KeybindingFileSnapshot> => ipcRenderer.invoke('keybindings:reload'),
    openFile: (): Promise<KeybindingFileSnapshot> => ipcRenderer.invoke('keybindings:openFile'),
    revealFile: (): Promise<KeybindingFileSnapshot> => ipcRenderer.invoke('keybindings:revealFile'),
    onChanged: (callback: (snapshot: KeybindingFileSnapshot) => void): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        snapshot: KeybindingFileSnapshot
      ): void => callback(snapshot)
      ipcRenderer.on('keybindings:changed', listener)
      return () => ipcRenderer.removeListener('keybindings:changed', listener)
    }
  },

  codexAccounts: {
    list: (): Promise<unknown> => ipcRenderer.invoke('codexAccounts:list'),
    add: (args?: { runtime?: 'host' | 'wsl'; wslDistro?: string | null }): Promise<unknown> =>
      ipcRenderer.invoke('codexAccounts:add', args),
    reauthenticate: (args: { accountId: string }): Promise<unknown> =>
      ipcRenderer.invoke('codexAccounts:reauthenticate', args),
    remove: (args: { accountId: string }): Promise<unknown> =>
      ipcRenderer.invoke('codexAccounts:remove', args),
    select: (args: {
      accountId: string | null
      runtime?: 'host' | 'wsl'
      wslDistro?: string | null
    }): Promise<unknown> => ipcRenderer.invoke('codexAccounts:select', args),
    listStalePanes: (args: {
      ptyIds: string[]
    }): Promise<
      {
        ptyId: string
        launchAccountId: string | null
        activeAccountId: string | null
        reason?: 'account-change' | 'home-route-change'
      }[]
    > => ipcRenderer.invoke('codexAccounts:listStalePanes', args),
    listRecordedPaneLanes: (args: { ptyIds: string[] }): Promise<Record<string, string>> =>
      ipcRenderer.invoke('codexAccounts:listRecordedPaneLanes', args),
    forgetStalePanes: (args: { ptyIds: string[] }): Promise<void> =>
      ipcRenderer.invoke('codexAccounts:forgetStalePanes', args)
  },

  claudeAccounts: {
    list: (): Promise<unknown> => ipcRenderer.invoke('claudeAccounts:list'),
    add: (args?: { runtime?: 'host' | 'wsl'; wslDistro?: string | null }): Promise<unknown> =>
      ipcRenderer.invoke('claudeAccounts:add', args),
    cancelPendingLogin: (): Promise<boolean> =>
      ipcRenderer.invoke('claudeAccounts:cancelPendingLogin'),
    reauthenticate: (args: { accountId: string }): Promise<unknown> =>
      ipcRenderer.invoke('claudeAccounts:reauthenticate', args),
    remove: (args: { accountId: string }): Promise<unknown> =>
      ipcRenderer.invoke('claudeAccounts:remove', args),
    select: (args: {
      accountId: string | null
      runtime?: 'host' | 'wsl'
      wslDistro?: string | null
    }): Promise<unknown> => ipcRenderer.invoke('claudeAccounts:select', args)
  },

  cli: {
    getInstallStatus: (): Promise<CliInstallStatus> => ipcRenderer.invoke('cli:getInstallStatus'),
    install: (): Promise<CliInstallStatus> => ipcRenderer.invoke('cli:install'),
    remove: (): Promise<CliInstallStatus> => ipcRenderer.invoke('cli:remove'),
    getWslInstallStatus: (args?: { distro?: string | null }): Promise<CliInstallStatus> =>
      ipcRenderer.invoke('cli:getWslInstallStatus', args),
    installWsl: (args?: { distro?: string | null }): Promise<CliInstallStatus> =>
      ipcRenderer.invoke('cli:installWsl', args),
    removeWsl: (args?: { distro?: string | null }): Promise<CliInstallStatus> =>
      ipcRenderer.invoke('cli:removeWsl', args)
  },

  codexConfigSync: {
    status: (): Promise<CodexConfigSyncStatus> => ipcRenderer.invoke('codexConfigSync:status')
  },
  agentHooks: {
    claudeStatus: (): Promise<AgentHookInstallStatus> =>
      ipcRenderer.invoke('agentHooks:claudeStatus'),
    codexStatus: (): Promise<AgentHookInstallStatus> =>
      ipcRenderer.invoke('agentHooks:codexStatus')
  },

  agentTrust: {
    markTrusted: (args: {
      preset: 'claude' | 'codex'
      workspacePath: string
      connectionId?: string
    }): Promise<void> => ipcRenderer.invoke('agentTrust:markTrusted', args)
  },

  preflight: {
    check: (args?: {
      force?: boolean
    }): Promise<{
      git: { installed: boolean }
      gh: { installed: boolean; authenticated: boolean }
    }> => ipcRenderer.invoke('preflight:check', args),
    detectAgents: (args?: PreflightRuntimeContext): Promise<string[]> =>
      ipcRenderer.invoke('preflight:detectAgents', args),
    refreshAgents: (args?: PreflightRuntimeContext): Promise<RefreshAgentsResult> =>
      ipcRenderer.invoke('preflight:refreshAgents', args),
    detectRemoteAgents: (args: { connectionId: string }): Promise<string[]> =>
      ipcRenderer.invoke('preflight:detectRemoteAgents', args),
    detectRemoteWindowsTerminalCapabilities: (args: {
      connectionId: string
    }): Promise<{
      wslAvailable: boolean
      wslDistros: string[]
      pwshAvailable: boolean
      gitBashAvailable: boolean
      hostPlatform: NodeJS.Platform | null
    }> => ipcRenderer.invoke('preflight:detectRemoteWindowsTerminalCapabilities', args)
  },

  notifications: {
    dispatch: (args: Record<string, unknown>): Promise<NotificationDispatchResult> =>
      ipcRenderer.invoke('notifications:dispatch', args),
    dismiss: (ids: string[]): Promise<NotificationDismissResult> =>
      ipcRenderer.invoke('notifications:dismiss', ids),
    openSystemSettings: (): Promise<void> => ipcRenderer.invoke('notifications:openSystemSettings'),
    getPermissionStatus: (): Promise<NotificationPermissionStatusResult> =>
      ipcRenderer.invoke('notifications:getPermissionStatus'),
    probeDelivery: (args?: { force?: boolean }): Promise<NotificationDeliveryProbeResult> =>
      ipcRenderer.invoke('notifications:probeDelivery', args),
    playSound: async (options?: {
      force?: boolean
      volume?: number
    }): Promise<NotificationSoundResult> => {
      try {
        // Why: drop replays while still ringing; the test button passes force to always confirm.
        if (!options?.force && isNotificationSoundPlaying) {
          return { played: false, reason: 'deduped' }
        }

        const resolved = (await ipcRenderer.invoke(
          'notifications:resolveSoundPath'
        )) as NotificationSoundPathResult
        if (!resolved.ok) {
          if (cachedNotificationSound) {
            disposeCachedNotificationSound()
          }
          return { played: false, reason: resolved.reason }
        }

        let entry = cachedNotificationSound
        if (!entry || entry.path !== resolved.path) {
          const sound = (await ipcRenderer.invoke(
            'notifications:loadSound'
          )) as NotificationSoundDataResult
          if (!sound.ok) {
            disposeCachedNotificationSound()
            return { played: false, reason: sound.reason }
          }
          const arrayBuffer = new ArrayBuffer(sound.data.byteLength)
          new Uint8Array(arrayBuffer).set(sound.data)
          const blob = new Blob([arrayBuffer], { type: sound.mimeType })
          disposeCachedNotificationSound()
          const blobUrl = URL.createObjectURL(blob)
          entry = { path: sound.path, blobUrl, audio: new Audio(blobUrl) }
          cachedNotificationSound = entry
        }

        const audio = entry.audio
        // Why: restart from zero on each play so bursts replay instead of stacking copies (GNOME canberra / VS Code signal service).
        audio.currentTime = 0
        if (typeof options?.volume === 'number' && Number.isFinite(options.volume)) {
          audio.volume = Math.min(1, Math.max(0, options.volume / 100))
        }
        isNotificationSoundPlaying = true
        cleanupNotificationSoundPlayback?.()
        const release = (): void => {
          cleanup()
          if (cleanupNotificationSoundPlayback === cleanup) {
            cleanupNotificationSoundPlayback = null
          }
          isNotificationSoundPlaying = false
        }
        const cleanup = (): void => {
          audio.removeEventListener('ended', release)
          audio.removeEventListener('error', release)
        }
        cleanupNotificationSoundPlayback = cleanup
        audio.addEventListener('ended', release)
        audio.addEventListener('error', release)
        try {
          await audio.play()
        } catch {
          release()
          return { played: false, reason: 'playback-failed' }
        }
        return { played: true }
      } catch {
        clearNotificationSoundPlaybackState()
        return { played: false, reason: 'playback-failed' }
      }
    }
  },

  onboarding: {
    get: (): Promise<OnboardingState> => ipcRenderer.invoke('onboarding:get'),
    update: (
      updates: Partial<Omit<OnboardingState, 'checklist'>> & {
        checklist?: Partial<OnboardingState['checklist']>
      }
    ): Promise<OnboardingState> => ipcRenderer.invoke('onboarding:update', updates)
  },

  dashboard: {
    revealAgent: (args: DashboardRevealAgentArgs): Promise<void> =>
      ipcRenderer.invoke('dashboardPopout:revealAgent', args),
    ackAgent: (paneKey: string): Promise<void> =>
      ipcRenderer.invoke('dashboardPopout:ackAgent', { paneKey }),
    spawnAgent: (args: DashboardSpawnAgentArgs): Promise<void> =>
      ipcRenderer.invoke('dashboardPopout:spawnAgent', args),
    sleepWorkspace: (args: DashboardSleepWorkspaceArgs): Promise<void> =>
      ipcRenderer.invoke('dashboardPopout:sleepWorkspace', args)
  },

  terminalPreview: {
    connect: (
      ptyId: string,
      opts?: { scrollbackRows?: number }
    ): Promise<TerminalPreviewConnectResult> =>
      ipcRenderer.invoke('terminalPreview:connect', { ptyId, opts }),
    input: (ptyId: string, data: string): Promise<boolean> =>
      ipcRenderer.invoke('terminalPreview:input', { ptyId, data }),
    fit: (
      ptyId: string,
      cols: number,
      rows: number
    ): Promise<{ cols: number; rows: number } | null> =>
      ipcRenderer.invoke('terminalPreview:fit', { ptyId, cols, rows }),
    ack: (ptyId: string, bytes: number): Promise<void> =>
      ipcRenderer.invoke('terminalPreview:ack', { ptyId, bytes }),
    unsubscribe: (ptyId: string): Promise<void> =>
      ipcRenderer.invoke('terminalPreview:unsubscribe', { ptyId }),
    onData: (callback: (payload: TerminalPreviewDataPayload) => void): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: TerminalPreviewDataPayload
      ): void => callback(payload)
      ipcRenderer.on('terminalPreview:data', listener)
      return () => ipcRenderer.removeListener('terminalPreview:data', listener)
    }
  },

  developerPermissions: {
    getStatus: (): Promise<unknown> => ipcRenderer.invoke('developerPermissions:getStatus'),
    request: (args: { id: string }): Promise<unknown> =>
      ipcRenderer.invoke('developerPermissions:request', args),
    openSettings: (args: { id: string }): Promise<void> =>
      ipcRenderer.invoke('developerPermissions:openSettings', args),
    testLocalNetworkConnection: (args: { host: string; port: number }): Promise<unknown> =>
      ipcRenderer.invoke('developerPermissions:testLocalNetworkConnection', args)
  },

  shell: {
    openPath: (path: string): Promise<void> => ipcRenderer.invoke('shell:openPath', path),

    openInFileManager: (path: string): Promise<ShellOpenLocalPathResult> =>
      ipcRenderer.invoke('shell:openInFileManager', path),

    openInExternalEditor: (
      request: ShellOpenExternalEditorRequest
    ): Promise<ShellOpenExternalEditorResult> =>
      ipcRenderer.invoke('shell:openInExternalEditor', request),

    openUrl: (url: string): Promise<void> => ipcRenderer.invoke('shell:openUrl', url),

    openFilePath: (path: string): Promise<boolean> =>
      ipcRenderer.invoke('shell:openFilePath', path),

    openFileUri: (uri: string): Promise<void> => ipcRenderer.invoke('shell:openFileUri', uri),

    pathExists: (path: string): Promise<boolean> => ipcRenderer.invoke('shell:pathExists', path),

    pickAttachment: (): Promise<string | null> => ipcRenderer.invoke('shell:pickAttachment'),

    pickImage: (): Promise<string | null> => ipcRenderer.invoke('shell:pickImage'),

    pickRepoIconImage: (): Promise<{ dataUrl: string; fileName: string } | null> =>
      ipcRenderer.invoke('shell:pickRepoIconImage'),

    pickAudio: (): Promise<string | null> => ipcRenderer.invoke('shell:pickAudio'),

    pickDirectory: (args: { defaultPath?: string }): Promise<string | null> =>
      ipcRenderer.invoke('shell:pickDirectory', args),

    copyFile: (args: { srcPath: string; destPath: string }): Promise<void> =>
      ipcRenderer.invoke('shell:copyFile', args)
  },

  skills: {
    discover: (target?: SkillDiscoveryTarget): Promise<SkillDiscoveryResult> =>
      ipcRenderer.invoke('skills:discover', target),
    freshnessInventory: (): Promise<SkillFreshnessInventory> =>
      ipcRenderer.invoke('skills:freshnessInventory'),
    startUpdateRun: (names: string[]): Promise<SkillUpdateStartResult> =>
      ipcRenderer.invoke('skills:startUpdateRun', names),
    cancelUpdateRun: (): Promise<void> => ipcRenderer.invoke('skills:cancelUpdateRun'),
    acknowledgeUpdateRun: (): Promise<void> => ipcRenderer.invoke('skills:acknowledgeUpdateRun'),
    getUpdateRun: (): Promise<SkillUpdateRun> => ipcRenderer.invoke('skills:getUpdateRun'),
    onUpdateRun: (callback: (run: SkillUpdateRun) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, run: SkillUpdateRun): void =>
        callback(run)
      ipcRenderer.on('skills:updateRun', listener)
      return () => ipcRenderer.removeListener('skills:updateRun', listener)
    }
  },

  pet: {
    import: (): Promise<CustomPet | null> => ipcRenderer.invoke('pet:import'),
    importPetBundle: (): Promise<CustomPet | null> => ipcRenderer.invoke('pet:importPetBundle'),
    read: (id: string, fileName: string, kind?: 'image' | 'bundle'): Promise<ArrayBuffer | null> =>
      ipcRenderer.invoke('pet:read', id, fileName, kind),
    delete: (id: string, fileName: string, kind?: 'image' | 'bundle'): Promise<void> =>
      ipcRenderer.invoke('pet:delete', id, fileName, kind)
  },

  browser: {
    registerGuest: (args: {
      browserPageId: string
      workspaceId: string
      worktreeId: string
      sessionProfileId?: string | null
      webContentsId: number
    }): Promise<boolean> => ipcRenderer.invoke('browser:registerGuest', args),

    isGuestRegistered: (args: { browserPageId: string; webContentsId: number }): Promise<boolean> =>
      ipcRenderer.invoke('browser:isGuestRegistered', args),

    repairGuestRegistration: (args: {
      browserPageId: string
      workspaceId: string
      worktreeId: string
      sessionProfileId?: string | null
      webContentsId: number
    }): Promise<boolean> => ipcRenderer.invoke('browser:repairGuestRegistration', args),

    unregisterGuest: (args: { browserPageId: string }): Promise<void> =>
      ipcRenderer.invoke('browser:unregisterGuest', args),

    openDevTools: (args: { browserPageId: string }): Promise<boolean> =>
      ipcRenderer.invoke('browser:openDevTools', args),

    setViewportOverride: (args: {
      browserPageId: string
      override: BrowserViewportOverride | null
    }): Promise<boolean> => ipcRenderer.invoke('browser:setViewportOverride', args),

    setAnnotationViewportBridge: (args): Promise<boolean> =>
      ipcRenderer.invoke('browser:setAnnotationViewportBridge', args),

    onGuestLoadFailed: (
      callback: (args: {
        browserPageId: string
        loadError: { code: number; description: string; validatedUrl: string }
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          browserPageId: string
          loadError: { code: number; description: string; validatedUrl: string }
        }
      ) => callback(data)
      ipcRenderer.on('browser:guest-load-failed', listener)
      return () => ipcRenderer.removeListener('browser:guest-load-failed', listener)
    },

    onCertificateFailureChanged: (callback): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: Parameters<typeof callback>[0]
      ): void => callback(data)
      ipcRenderer.on('browser:certificate-failure-changed', listener)
      return () => ipcRenderer.removeListener('browser:certificate-failure-changed', listener)
    },

    proceedCertificate: (args) => ipcRenderer.invoke('browser:proceedCertificate', args),

    onPermissionDenied: (
      callback: (event: { browserPageId: string; permission: string; origin: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { browserPageId: string; permission: string; origin: string }
      ) => callback(data)
      ipcRenderer.on('browser:permission-denied', listener)
      return () => ipcRenderer.removeListener('browser:permission-denied', listener)
    },

    onPopup: (
      callback: (event: {
        browserPageId: string
        origin: string
        action: 'opened-in-orca' | 'opened-external' | 'blocked'
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          browserPageId: string
          origin: string
          action: 'opened-in-orca' | 'opened-external' | 'blocked'
        }
      ) => callback(data)
      ipcRenderer.on('browser:popup', listener)
      return () => ipcRenderer.removeListener('browser:popup', listener)
    },

    onDownloadRequested: (
      callback: (event: {
        browserPageId: string
        downloadId: string
        origin: string
        filename: string
        totalBytes: number | null
        mimeType: string | null
        savePath: string
        status: 'downloading'
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          browserPageId: string
          downloadId: string
          origin: string
          filename: string
          totalBytes: number | null
          mimeType: string | null
          savePath: string
          status: 'downloading'
        }
      ) => callback(data)
      ipcRenderer.on('browser:download-requested', listener)
      return () => ipcRenderer.removeListener('browser:download-requested', listener)
    },

    onDownloadProgress: (
      callback: (event: {
        browserPageId?: string
        downloadId: string
        receivedBytes: number
        totalBytes: number | null
        state: 'progressing' | 'interrupted' | null
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          browserPageId?: string
          downloadId: string
          receivedBytes: number
          totalBytes: number | null
          state: 'progressing' | 'interrupted' | null
        }
      ) => callback(data)
      ipcRenderer.on('browser:download-progress', listener)
      return () => ipcRenderer.removeListener('browser:download-progress', listener)
    },

    onDownloadFinished: (
      callback: (event: {
        browserPageId?: string
        downloadId: string
        status: 'completed' | 'canceled' | 'failed'
        savePath: string | null
        error: string | null
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          browserPageId?: string
          downloadId: string
          status: 'completed' | 'canceled' | 'failed'
          savePath: string | null
          error: string | null
        }
      ) => callback(data)
      ipcRenderer.on('browser:download-finished', listener)
      return () => ipcRenderer.removeListener('browser:download-finished', listener)
    },

    onContextMenuRequested: (
      callback: (event: {
        browserPageId: string
        x: number
        y: number
        screenX: number
        screenY: number
        pageUrl: string
        linkUrl: string | null
        selectionText: string
        canGoBack: boolean
        canGoForward: boolean
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          browserPageId: string
          x: number
          y: number
          screenX: number
          screenY: number
          pageUrl: string
          linkUrl: string | null
          selectionText: string
          canGoBack: boolean
          canGoForward: boolean
        }
      ) => callback(data)
      ipcRenderer.on('browser:context-menu-requested', listener)
      return () => ipcRenderer.removeListener('browser:context-menu-requested', listener)
    },

    onContextMenuDismissed: (
      callback: (event: { browserPageId: string }) => void
    ): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { browserPageId: string }) =>
        callback(data)
      ipcRenderer.on('browser:context-menu-dismissed', listener)
      return () => ipcRenderer.removeListener('browser:context-menu-dismissed', listener)
    },

    onNavigationUpdate: (
      callback: (event: { browserPageId: string; url: string; title: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { browserPageId: string; url: string; title: string }
      ) => callback(data)
      ipcRenderer.on('browser:navigation-update', listener)
      return () => ipcRenderer.removeListener('browser:navigation-update', listener)
    },

    onActivateView: (
      callback: (data: { worktreeId?: string; browserPageId?: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { worktreeId?: string; browserPageId?: string }
      ) => callback(data)
      ipcRenderer.on('browser:activateView', listener)
      return () => ipcRenderer.removeListener('browser:activateView', listener)
    },

    onPaneFocus: (
      callback: (data: { worktreeId: string | null; browserPageId: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { worktreeId: string | null; browserPageId: string }
      ) => callback(data)
      ipcRenderer.on('browser:pane-focus', listener)
      return () => ipcRenderer.removeListener('browser:pane-focus', listener)
    },

    onOpenLinkInOrcaTab: (
      callback: (event: { browserPageId: string; url: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { browserPageId: string; url: string }
      ) => callback(data)
      ipcRenderer.on('browser:open-link-in-orca-tab', listener)
      return () => ipcRenderer.removeListener('browser:open-link-in-orca-tab', listener)
    },

    cancelDownload: (args: { downloadId: string }): Promise<boolean> =>
      ipcRenderer.invoke('browser:cancelDownload', args),

    setGrabMode: (args: {
      browserPageId: string
      enabled: boolean
    }): Promise<{ ok: true } | { ok: false; reason: string }> =>
      ipcRenderer.invoke('browser:setGrabMode', args),

    awaitGrabSelection: (args: { browserPageId: string; opId: string }): Promise<unknown> =>
      ipcRenderer.invoke('browser:awaitGrabSelection', args),

    cancelGrab: (args: { browserPageId: string }): Promise<boolean> =>
      ipcRenderer.invoke('browser:cancelGrab', args),

    captureSelectionScreenshot: (args: {
      browserPageId: string
      rect: { x: number; y: number; width: number; height: number }
    }): Promise<{ ok: true; screenshot: unknown } | { ok: false; reason: string }> =>
      ipcRenderer.invoke('browser:captureSelectionScreenshot', args),

    extractHoverPayload: (args: {
      browserPageId: string
    }): Promise<{ ok: true; payload: unknown } | { ok: false; reason: string }> =>
      ipcRenderer.invoke('browser:extractHoverPayload', args),

    onGrabModeToggle: (callback: (browserPageId: string) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, browserPageId: string) =>
        callback(browserPageId)
      ipcRenderer.on('browser:grabModeToggle', listener)
      return () => ipcRenderer.removeListener('browser:grabModeToggle', listener)
    },

    onGrabActionShortcut: (
      callback: (args: { browserPageId: string; key: 'c' | 's' }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { browserPageId: string; key: 'c' | 's' }
      ) => callback(data)
      ipcRenderer.on('browser:grabActionShortcut', listener)
      return () => ipcRenderer.removeListener('browser:grabActionShortcut', listener)
    },

    sessionListProfiles: (): Promise<unknown[]> =>
      ipcRenderer.invoke('browser:session:listProfiles'),

    sessionCreateProfile: (args: {
      scope: 'default' | 'isolated' | 'imported'
      label: string
      userAgentMode?: 'clean' | 'native'
    }): Promise<unknown> => ipcRenderer.invoke('browser:session:createProfile', args),

    sessionDeleteProfile: (args: { profileId: string }): Promise<boolean> =>
      ipcRenderer.invoke('browser:session:deleteProfile', args),

    sessionImportCookies: (args: {
      profileId: string
    }): Promise<
      { ok: true; profileId: string; summary: unknown } | { ok: false; reason: string }
    > => ipcRenderer.invoke('browser:session:importCookies', args),

    sessionResolvePartition: (args: { profileId: string | null }): Promise<string | null> =>
      ipcRenderer.invoke('browser:session:resolvePartition', args),

    sessionDetectBrowsers: (): Promise<unknown[]> =>
      ipcRenderer.invoke('browser:session:detectBrowsers'),

    sessionImportFromBrowser: (args: {
      profileId: string
      browserFamily: string
    }): Promise<
      { ok: true; profileId: string; summary: unknown } | { ok: false; reason: string }
    > => ipcRenderer.invoke('browser:session:importFromBrowser', args),

    sessionClearDefaultCookies: (): Promise<boolean> =>
      ipcRenderer.invoke('browser:session:clearDefaultCookies'),

    notifyActiveTabChanged: (args: { browserPageId: string }): Promise<boolean> =>
      ipcRenderer.invoke('browser:activeTabChanged', args)
  },

  emulator: {
    startFrameStream: (args: {
      streamUrl: string
      streamKey?: string
    }): Promise<{
      streamId: string
    }> => ipcRenderer.invoke('emulator:frameStreamStart', args),
    stopFrameStream: (args: { streamId: string }): Promise<void> =>
      ipcRenderer.invoke('emulator:frameStreamStop', args),
    onFrameStreamFrame: (
      callback: (data: { streamId: string; bytes: ArrayBuffer }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { streamId: string; bytes: ArrayBuffer }
      ) => callback(data)
      ipcRenderer.on('emulator:frameStreamFrame', listener)
      return () => ipcRenderer.removeListener('emulator:frameStreamFrame', listener)
    },
    onFrameStreamError: (
      callback: (data: { streamId: string; message: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { streamId: string; message: string }
      ) => callback(data)
      ipcRenderer.on('emulator:frameStreamError', listener)
      return () => ipcRenderer.removeListener('emulator:frameStreamError', listener)
    },
    startVideoStream: (args: {
      deviceId: string
      streamId: string
    }): Promise<{ streamId: string }> => ipcRenderer.invoke('emulator:videoStreamStart', args),
    stopVideoStream: (args: { streamId: string }): Promise<void> =>
      ipcRenderer.invoke('emulator:videoStreamStop', args),
    onVideoStreamMeta: (
      callback: (data: {
        streamId: string
        deviceId: string
        meta: { codecId: string; width: number; height: number }
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          streamId: string
          deviceId: string
          meta: { codecId: string; width: number; height: number }
        }
      ) => callback(data)
      ipcRenderer.on('emulator:videoStreamMeta', listener)
      return () => ipcRenderer.removeListener('emulator:videoStreamMeta', listener)
    },
    onVideoStreamFrame: (
      callback: (data: {
        streamId: string
        deviceId: string
        config: boolean
        keyFrame: boolean
        bytes: ArrayBuffer
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          streamId: string
          deviceId: string
          config: boolean
          keyFrame: boolean
          bytes: ArrayBuffer
        }
      ) => callback(data)
      ipcRenderer.on('emulator:videoStreamFrame', listener)
      return () => ipcRenderer.removeListener('emulator:videoStreamFrame', listener)
    },
    onPaneFocus: (callback: (data: { worktreeId: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { worktreeId: string }) =>
        callback(data)
      ipcRenderer.on('emulator:pane-focus', listener)
      return () => ipcRenderer.removeListener('emulator:pane-focus', listener)
    },
    onAutoAttach: (
      callback: (data: {
        worktreeId: string
        info: { deviceUdid: string; streamUrl: string; wsUrl: string; axUrl?: string }
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          worktreeId: string
          info: { deviceUdid: string; streamUrl: string; wsUrl: string; axUrl?: string }
        }
      ) => callback(data)
      ipcRenderer.on('ui:emulatorAutoAttach', listener)
      return () => ipcRenderer.removeListener('ui:emulatorAutoAttach', listener)
    }
  },

  hooks: {
    check: (args: {
      repoId: string
      hostId?: ExecutionHostId
    }): Promise<{
      status?: 'ok' | 'error'
      hasHooks: boolean
      hooks: unknown
      mayNeedUpdate: boolean
    }> => ipcRenderer.invoke('hooks:check', args),

    inspectSetupScriptImports: (args: {
      repoId: string
      hostId?: ExecutionHostId
    }): Promise<unknown[]> => ipcRenderer.invoke('hooks:inspectSetupScriptImports', args),

    createIssueCommandRunner: (args: {
      repoId: string
      worktreePath: string
      command: string
    }): Promise<WorktreeSetupLaunch> => ipcRenderer.invoke('hooks:createIssueCommandRunner', args),

    readIssueCommand: (args: {
      repoId: string
      hostId?: ExecutionHostId
    }): Promise<{
      status?: 'ok' | 'error'
      localContent: string | null
      sharedContent: string | null
      effectiveContent: string | null
      localFilePath: string
      source: 'local' | 'shared' | 'none'
    }> => ipcRenderer.invoke('hooks:readIssueCommand', args),

    writeIssueCommand: (args: {
      repoId: string
      content: string
      hostId?: ExecutionHostId
    }): Promise<void> => ipcRenderer.invoke('hooks:writeIssueCommand', args)
  },

  cache: {
    getGitHub: () => ipcRenderer.invoke('cache:getGitHub'),
    setGitHub: (args) => ipcRenderer.invoke('cache:setGitHub', args)
  } satisfies PreloadApi['cache'],

  session: {
    // hostId is optional; main defaults it to 'local' so existing omitting call sites keep the local session partition.
    get: (hostId) => ipcRenderer.invoke('session:get', hostId),
    set: (args, hostId) => ipcRenderer.invoke('session:set', args, hostId),
    patch: (args, hostId) => ipcRenderer.invoke('session:patch', args, hostId),
    flush: () => ipcRenderer.invoke('session:flush'),
    readTerminalScrollback: (args) =>
      ipcRenderer.sendSync('session:read-terminal-scrollback-sync', args),
    /** Synchronous session save for beforeunload — blocks until flushed to disk. */
    setSync: (args, hostId) => {
      ipcRenderer.sendSync('session:set-sync', args, hostId)
    }
  } satisfies PreloadApi['session'],

  updater: {
    dismissNudge: () => Promise.resolve(),
    dismissAvailableUpdate: () => Promise.resolve()
  } satisfies PreloadApi['updater'],

  notebook: {
    runPythonCell: (args: {
      filePath: string
      code: string
      preamble?: string
      connectionId?: string | null
    }): Promise<{ stdout: string; stderr: string; exitCode: number | null; error?: string }> =>
      ipcRenderer.invoke('notebook:runPythonCell', args)
  },

  fs: {
    readDir: (args: {
      dirPath: string
      connectionId?: string
    }): Promise<{ name: string; isDirectory: boolean; isSymlink: boolean }[]> =>
      ipcRenderer.invoke('fs:readDir', args),
    readFile: (args: {
      filePath: string
      connectionId?: string
      includeLocalLogMetadata?: boolean
    }): Promise<{
      content: string
      isBinary: boolean
      isImage?: boolean
      mimeType?: string
      fileIdentity?: string
    }> => ipcRenderer.invoke('fs:readFile', args),
    readLocalLogTail: (args: LocalLogTailReadArgs): Promise<LocalLogTailReadResult> =>
      ipcRenderer.invoke('fs:readLocalLogTail', args),
    startLocalLogTail: (args: LocalLogTailWatchArgs): Promise<void> =>
      ipcRenderer.invoke('fs:startLocalLogTail', args),
    stopLocalLogTail: (args: { subscriptionId: string }): Promise<void> =>
      ipcRenderer.invoke('fs:stopLocalLogTail', args),
    onLocalLogTailChanged: (
      callback: (payload: LocalLogTailChangedPayload) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: LocalLogTailChangedPayload
      ): void => callback(payload)
      ipcRenderer.on('fs:localLogTailChanged', listener)
      return () => ipcRenderer.removeListener('fs:localLogTailChanged', listener)
    },
    downloadFile: (args: {
      filePath: string
      connectionId: string
    }): Promise<{ canceled: true } | { canceled: false; destinationPath: string }> =>
      ipcRenderer.invoke('fs:downloadFile', args),
    downloadFolder: (args: {
      dirPath: string
      connectionId: string
    }): Promise<{ canceled: true } | { canceled: false; destinationPath: string }> =>
      ipcRenderer.invoke('fs:downloadFolder', args),
    saveDownloadedFile: (args: {
      suggestedName: string
      content: string
      encoding: 'utf8' | 'base64'
    }): Promise<{ canceled: true } | { canceled: false; destinationPath: string }> =>
      ipcRenderer.invoke('fs:saveDownloadedFile', args),
    startDownloadedFile: (args: {
      suggestedName: string
    }): Promise<
      { canceled: true } | { canceled: false; transferId: string; destinationPath: string }
    > => ipcRenderer.invoke('fs:startDownloadedFile', args),
    appendDownloadedFileChunk: (args: {
      transferId: string
      contentBase64: string
    }): Promise<{ ok: true }> => ipcRenderer.invoke('fs:appendDownloadedFileChunk', args),
    finishDownloadedFile: (args: {
      transferId: string
    }): Promise<{ canceled: false; destinationPath: string }> =>
      ipcRenderer.invoke('fs:finishDownloadedFile', args),
    cancelDownloadedFile: (args: { transferId: string }): Promise<{ ok: true }> =>
      ipcRenderer.invoke('fs:cancelDownloadedFile', args),
    listMarkdownDocuments: (args: {
      rootPath: string
      connectionId?: string
    }): Promise<{ filePath: string; relativePath: string; basename: string; name: string }[]> =>
      ipcRenderer.invoke('fs:listMarkdownDocuments', args),
    writeFile: (
      args: {
        filePath: string
        content: string
        connectionId?: string
      }
    ): Promise<void> => ipcRenderer.invoke('fs:writeFile', args),
    createFile: (
      args: { filePath: string; connectionId?: string }
    ): Promise<void> => ipcRenderer.invoke('fs:createFile', args),
    createDir: (
      args: { dirPath: string; connectionId?: string }
    ): Promise<void> => ipcRenderer.invoke('fs:createDir', args),
    rename: (
      args: { oldPath: string; newPath: string; connectionId?: string }
    ): Promise<void> => ipcRenderer.invoke('fs:rename', args),
    copy: (
      args: {
        sourcePath: string
        destinationPath: string
        connectionId?: string
      }
    ): Promise<void> => ipcRenderer.invoke('fs:copy', args),
    deletePath: (
      args: {
        targetPath: string
        connectionId?: string
        recursive?: boolean
      }
    ): Promise<void> => ipcRenderer.invoke('fs:deletePath', args),
    authorizeExternalPath: (args: { targetPath: string }): Promise<void> =>
      ipcRenderer.invoke('fs:authorizeExternalPath', args),
    stat: (args: {
      filePath: string
      connectionId?: string
    }): Promise<{ size: number; isDirectory: boolean; mtime: number }> =>
      ipcRenderer.invoke('fs:stat', args),
    pathExists: (args: { filePath: string; connectionId?: string }): Promise<boolean> =>
      ipcRenderer.invoke('fs:pathExists', args),
    listFiles: (args: {
      rootPath: string
      connectionId?: string
      excludePaths?: string[]
      requestToken?: string
    }): Promise<string[]> => ipcRenderer.invoke('fs:listFiles', args),
    cancelListFiles: (args: { requestToken: string }): Promise<void> =>
      ipcRenderer.invoke('fs:cancelListFiles', args),
    search: (args: {
      query: string
      rootPath: string
      caseSensitive?: boolean
      wholeWord?: boolean
      useRegex?: boolean
      includePattern?: string
      excludePattern?: string
      maxResults?: number
      connectionId?: string
    }): Promise<SearchResult> => ipcRenderer.invoke('fs:search', args),
    importExternalPaths: (
      args: {
        sourcePaths: string[]
        destDir: string
        connectionId?: string
        ensureDir?: boolean
      }
    ): Promise<{
      results: (
        | {
            sourcePath: string
            status: 'imported'
            destPath: string
            kind: 'file' | 'directory'
            renamed: boolean
          }
        | {
            sourcePath: string
            status: 'skipped'
            reason: 'missing' | 'symlink' | 'permission-denied' | 'unsupported'
          }
        | {
            sourcePath: string
            status: 'failed'
            reason: string
          }
      )[]
    }> => ipcRenderer.invoke('fs:importExternalPaths', args),
    stageExternalPathsForRuntimeUpload: (args: {
      sourcePaths: string[]
    }): Promise<{
      sources: (
        | {
            sourcePath: string
            status: 'staged'
            name: string
            kind: 'file' | 'directory'
            entries: (
              | { relativePath: string; kind: 'directory' }
              | { relativePath: string; kind: 'file'; contentBase64: string }
            )[]
          }
        | {
            sourcePath: string
            status: 'skipped'
            reason: 'missing' | 'symlink' | 'permission-denied' | 'unsupported'
          }
        | {
            sourcePath: string
            status: 'failed'
            reason: string
          }
      )[]
    }> => ipcRenderer.invoke('fs:stageExternalPathsForRuntimeUpload', args),
    resolveDroppedPathsForAgent: (
      args: {
        paths: string[]
        worktreePath: string
        connectionId?: string
      }
    ): Promise<{
      resolvedPaths: string[]
      skipped: {
        sourcePath: string
        reason: 'missing' | 'symlink' | 'permission-denied' | 'unsupported'
      }[]
      failed: { sourcePath: string; reason: string }[]
    }> => ipcRenderer.invoke('fs:resolveDroppedPathsForAgent', args),
    watchWorktree: (args: { worktreePath: string; connectionId?: string }): Promise<void> =>
      ipcRenderer.invoke('fs:watchWorktree', args),
    unwatchWorktree: (args: { worktreePath: string; connectionId?: string }): Promise<void> =>
      ipcRenderer.invoke('fs:unwatchWorktree', args),
    onFsChanged: (callback: (payload: FsChangedPayload) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: FsChangedPayload) =>
        callback(payload)
      ipcRenderer.on('fs:changed', listener)
      return () => ipcRenderer.removeListener('fs:changed', listener)
    }
  },

  git: {
    status: (args: {
      worktreePath: string
      connectionId?: string
      includeIgnored?: boolean
      bypassEffectiveUpstreamNegativeCache?: boolean
      reuseLineStats?: boolean
      branchLineTotalMergeBase?: string
      requestToken?: string
    }): Promise<unknown> => ipcRenderer.invoke('git:status', args),
    cancelStatus: (args: { requestToken: string }): Promise<void> =>
      ipcRenderer.invoke('git:cancelStatus', args),
    setStatusUpstreamRefWatch: (args: {
      worktreeId: string
      worktreePath: string
      executionHostId: string
      connectionId?: string
      branch?: string
      upstreamName?: string
    }): Promise<void> => ipcRenderer.invoke('git:setStatusUpstreamRefWatch', args),
    submoduleStatus: (args: {
      worktreePath: string
      submodulePath: string
      connectionId?: string
      area?: GitStagingArea
    }): Promise<unknown> => ipcRenderer.invoke('git:submoduleStatus', args),
    checkIgnored: (args: {
      worktreePath: string
      paths: string[]
      connectionId?: string
    }): Promise<string[]> => ipcRenderer.invoke('git:checkIgnored', args),
    findHugeFoldersToIgnore: (args: { worktreePath: string }): Promise<string[]> =>
      ipcRenderer.invoke('git:findHugeFoldersToIgnore', args),
    appendGitignore: (args: { worktreePath: string; folderName: string }): Promise<boolean> =>
      ipcRenderer.invoke('git:appendGitignore', args),
    history: (
      args: { worktreePath: string; connectionId?: string } & GitHistoryOptions
    ): Promise<GitHistoryResult> => ipcRenderer.invoke('git:history', args),
    conflictOperation: (args: { worktreePath: string; connectionId?: string }): Promise<unknown> =>
      ipcRenderer.invoke('git:conflictOperation', args),
    abortMerge: (args: { worktreePath: string; connectionId?: string }): Promise<void> =>
      ipcRenderer.invoke('git:abortMerge', args),
    abortRebase: (args: { worktreePath: string; connectionId?: string }): Promise<void> =>
      ipcRenderer.invoke('git:abortRebase', args),
    diff: (args: {
      worktreePath: string
      filePath: string
      staged: boolean
      compareAgainstHead?: boolean
      connectionId?: string
    }): Promise<unknown> => ipcRenderer.invoke('git:diff', args),
    branchCompare: (args: {
      worktreePath: string
      baseRef: string
      connectionId?: string
    }): Promise<unknown> => ipcRenderer.invoke('git:branchCompare', args),
    commitCompare: (args: {
      worktreePath: string
      commitId: string
      connectionId?: string
    }): Promise<unknown> => ipcRenderer.invoke('git:commitCompare', args),
    upstreamStatus: (args: {
      worktreePath: string
      connectionId?: string
      pushTarget?: GitPushTarget
    }): Promise<GitUpstreamStatus> => ipcRenderer.invoke('git:upstreamStatus', args),
    fetch: (args: {
      worktreePath: string
      connectionId?: string
      pushTarget?: GitPushTarget
    }): Promise<void> => ipcRenderer.invoke('git:fetch', args),
    syncFork: (args: {
      worktreePath: string
      connectionId?: string
      expectedUpstream: GitForkSyncExpectedUpstream
    }): Promise<GitForkSyncResult> => ipcRenderer.invoke('git:syncFork', args),
    push: (args: {
      worktreePath: string
      publish?: boolean
      forceWithLease?: boolean
      connectionId?: string
      pushTarget?: unknown
    }): Promise<void> => ipcRenderer.invoke('git:push', args),
    pull: (args: {
      worktreePath: string
      connectionId?: string
      pushTarget?: GitPushTarget
    }): Promise<void> => ipcRenderer.invoke('git:pull', args),
    fastForward: (args: {
      worktreePath: string
      connectionId?: string
      pushTarget?: GitPushTarget
    }): Promise<void> => ipcRenderer.invoke('git:fastForward', args),
    rebaseFromBase: (args: {
      worktreePath: string
      baseRef: string
      connectionId?: string
    }): Promise<void> => ipcRenderer.invoke('git:rebaseFromBase', args),
    branchDiff: (args: {
      worktreePath: string
      compare: { baseRef: string; baseOid: string; headOid: string; mergeBase: string }
      filePath: string
      oldPath?: string
      connectionId?: string
    }): Promise<unknown> => ipcRenderer.invoke('git:branchDiff', args),
    commitDiff: (args: {
      worktreePath: string
      commitOid: string
      parentOid?: string | null
      filePath: string
      oldPath?: string
      connectionId?: string
    }): Promise<unknown> => ipcRenderer.invoke('git:commitDiff', args),
    commit: (args: {
      worktreePath: string
      message: string
      connectionId?: string
    }): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('git:commit', args),
    generateCommitMessage: (args: {
      worktreePath: string
      worktreeId?: string
      repoId?: string
      connectionId?: string
      sourceControlAiResolvedParams?: unknown
      sourceControlAi?: unknown
      agentCmdOverrides?: Record<string, string>
    }): Promise<unknown> => ipcRenderer.invoke('git:generateCommitMessage', args),
    discoverCommitMessageModels: (args: {
      agentId: string
      worktreePath?: string
      connectionId?: string
    }): Promise<unknown> => ipcRenderer.invoke('git:discoverCommitMessageModels', args),
    cancelGenerateCommitMessage: (args: {
      worktreePath: string
      connectionId?: string
    }): Promise<void> => ipcRenderer.invoke('git:cancelGenerateCommitMessage', args),
    generatePullRequestFields: (args: {
      worktreePath: string
      worktreeId?: string
      repoId?: string
      base: string
      title: string
      body: string
      draft: boolean
      provider?: unknown
      useTemplate?: boolean
      connectionId?: string
      sourceControlAiResolvedParams?: unknown
      sourceControlAi?: unknown
      agentCmdOverrides?: Record<string, string>
    }): Promise<unknown> => ipcRenderer.invoke('git:generatePullRequestFields', args),
    cancelGeneratePullRequestFields: (args: {
      worktreePath: string
      connectionId?: string
    }): Promise<void> => ipcRenderer.invoke('git:cancelGeneratePullRequestFields', args),
    stage: (args: {
      worktreePath: string
      filePath: string
      connectionId?: string
    }): Promise<void> => ipcRenderer.invoke('git:stage', args),
    bulkStage: (args: {
      worktreePath: string
      filePaths: string[]
      connectionId?: string
    }): Promise<void> => ipcRenderer.invoke('git:bulkStage', args),
    unstage: (args: {
      worktreePath: string
      filePath: string
      connectionId?: string
    }): Promise<void> => ipcRenderer.invoke('git:unstage', args),
    bulkUnstage: (args: {
      worktreePath: string
      filePaths: string[]
      connectionId?: string
    }): Promise<void> => ipcRenderer.invoke('git:bulkUnstage', args),
    discard: (args: {
      worktreePath: string
      filePath: string
      connectionId?: string
    }): Promise<void> => ipcRenderer.invoke('git:discard', args),
    bulkDiscard: (args: {
      worktreePath: string
      filePaths: string[]
      connectionId?: string
    }): Promise<void> => ipcRenderer.invoke('git:bulkDiscard', args),
    remoteFileUrl: (args: {
      worktreePath: string
      relativePath: string
      line: number
      connectionId?: string
    }): Promise<string | null> => ipcRenderer.invoke('git:remoteFileUrl', args),
    remoteCommitUrl: (args: {
      worktreePath: string
      sha: string
      connectionId?: string
    }): Promise<string | null> => ipcRenderer.invoke('git:remoteCommitUrl', args)
  },

  ui: {
    get: () => ipcRenderer.invoke('ui:get'),
    set: (args) => ipcRenderer.invoke('ui:set', args),
    recordFeatureInteraction: (id) => ipcRenderer.invoke('ui:recordFeatureInteraction', id),
    onStateChanged: (callback: (ui: PersistedUIState) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, ui: PersistedUIState): void =>
        callback(ui)
      ipcRenderer.on('ui:stateChanged', listener)
      return () => ipcRenderer.removeListener('ui:stateChanged', listener)
    },
    onOpenSettings: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:openSettings', listener)
      return () => ipcRenderer.removeListener('ui:openSettings', listener)
    },
    consumePendingOpenSettings: (): Promise<boolean> =>
      ipcRenderer.invoke('ui:consumePendingOpenSettings'),
    onOpenSetupGuide: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:openSetupGuide', listener)
      return () => ipcRenderer.removeListener('ui:openSetupGuide', listener)
    },
    onOpenFeatureTour: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:openFeatureTour', listener)
      return () => ipcRenderer.removeListener('ui:openFeatureTour', listener)
    },
    onOpenCrashReport: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:openCrashReport', listener)
      return () => ipcRenderer.removeListener('ui:openCrashReport', listener)
    },
    onToggleLeftSidebar: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:toggleLeftSidebar', listener)
      return () => ipcRenderer.removeListener('ui:toggleLeftSidebar', listener)
    },
    onToggleRightSidebar: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:toggleRightSidebar', listener)
      return () => ipcRenderer.removeListener('ui:toggleRightSidebar', listener)
    },
    onToggleWorktreePalette: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:toggleWorktreePalette', listener)
      return () => ipcRenderer.removeListener('ui:toggleWorktreePalette', listener)
    },
    onToggleFloatingTerminal: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:toggleFloatingTerminal', listener)
      return () => ipcRenderer.removeListener('ui:toggleFloatingTerminal', listener)
    },
    onTerminalShortcutCaptured: (
      callback: (data: { actionId: KeybindingActionId }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { actionId: KeybindingActionId }
      ) => callback(data)
      ipcRenderer.on('ui:terminalShortcutCaptured', listener)
      return () => ipcRenderer.removeListener('ui:terminalShortcutCaptured', listener)
    },
    onOpenQuickOpen: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:openQuickOpen', listener)
      return () => ipcRenderer.removeListener('ui:openQuickOpen', listener)
    },
    onToggleQuickCommandsMenu: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:toggleQuickCommandsMenu', listener)
      return () => ipcRenderer.removeListener('ui:toggleQuickCommandsMenu', listener)
    },
    onOpenNewWorkspace: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:openNewWorkspace', listener)
      return () => ipcRenderer.removeListener('ui:openNewWorkspace', listener)
    },
    onDeleteCurrentWorkspace: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:deleteCurrentWorkspace', listener)
      return () => ipcRenderer.removeListener('ui:deleteCurrentWorkspace', listener)
    },
    onOpenWorkspaceBoard: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:openWorkspaceBoard', listener)
      return () => ipcRenderer.removeListener('ui:openWorkspaceBoard', listener)
    },
    onOpenTasks: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:openTasks', listener)
      return () => ipcRenderer.removeListener('ui:openTasks', listener)
    },
    onJumpToWorktreeIndex: (callback: (index: number) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, index: number) => callback(index)
      ipcRenderer.on('ui:jumpToWorktreeIndex', listener)
      return () => ipcRenderer.removeListener('ui:jumpToWorktreeIndex', listener)
    },
    onJumpToTabIndex: (callback: (index: number) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, index: number) => callback(index)
      ipcRenderer.on('ui:jumpToTabIndex', listener)
      return () => ipcRenderer.removeListener('ui:jumpToTabIndex', listener)
    },
    onWorktreeHistoryNavigate: (
      callback: (direction: 'back' | 'forward') => void
    ): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, direction: 'back' | 'forward') =>
        callback(direction)
      ipcRenderer.on('ui:worktreeHistoryNavigate', listener)
      return () => ipcRenderer.removeListener('ui:worktreeHistoryNavigate', listener)
    },
    onNewBrowserTab: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:newBrowserTab', listener)
      return () => ipcRenderer.removeListener('ui:newBrowserTab', listener)
    },
    onNewMarkdownTab: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:newMarkdownTab', listener)
      return () => ipcRenderer.removeListener('ui:newMarkdownTab', listener)
    },
    onNewSimulatorTab: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:newSimulatorTab', listener)
      return () => ipcRenderer.removeListener('ui:newSimulatorTab', listener)
    },
    onRequestTabCreate: (
      callback: (data: {
        requestId: string
        url: string
        worktreeId?: string
        sessionProfileId?: string | null
        sessionPartition?: string
        activate?: boolean
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          requestId: string
          url: string
          worktreeId?: string
          sessionProfileId?: string | null
          sessionPartition?: string
          activate?: boolean
        }
      ) => callback(data)
      ipcRenderer.on('browser:requestTabCreate', listener)
      return () => ipcRenderer.removeListener('browser:requestTabCreate', listener)
    },
    replyTabCreate: (reply: {
      requestId: string
      browserPageId?: string
      error?: string
    }): void => {
      ipcRenderer.send('browser:tabCreateReply', reply)
    },
    onRequestTabSetProfile: (
      callback: (data: {
        requestId: string
        browserPageId: string
        profileId: string
        sessionPartition?: string
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          requestId: string
          browserPageId: string
          profileId: string
          sessionPartition?: string
        }
      ) => callback(data)
      ipcRenderer.on('browser:requestTabSetProfile', listener)
      return () => ipcRenderer.removeListener('browser:requestTabSetProfile', listener)
    },
    replyTabSetProfile: (reply: { requestId: string; error?: string }): void => {
      ipcRenderer.send('browser:tabSetProfileReply', reply)
    },
    onRequestTabClose: (
      callback: (data: { requestId: string; tabId: string | null; worktreeId?: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { requestId: string; tabId: string | null; worktreeId?: string }
      ) => callback(data)
      ipcRenderer.on('browser:requestTabClose', listener)
      return () => ipcRenderer.removeListener('browser:requestTabClose', listener)
    },
    replyTabClose: (reply: { requestId: string; error?: string }): void => {
      ipcRenderer.send('browser:tabCloseReply', reply)
    },
    onNewTerminalTab: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:newTerminalTab', listener)
      return () => ipcRenderer.removeListener('ui:newTerminalTab', listener)
    },
    onFocusBrowserAddressBar: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:focusBrowserAddressBar', listener)
      return () => ipcRenderer.removeListener('ui:focusBrowserAddressBar', listener)
    },
    onFindInBrowserPage: browserFindSubscriptions.subscribe,
    onReloadBrowserPage: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:reloadBrowserPage', listener)
      return () => ipcRenderer.removeListener('ui:reloadBrowserPage', listener)
    },
    onBrowserHistoryNavigate: (callback: (direction: 'back' | 'forward') => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, direction: 'back' | 'forward'): void =>
        callback(direction)
      ipcRenderer.on('ui:browserHistoryNavigate', listener)
      return () => ipcRenderer.removeListener('ui:browserHistoryNavigate', listener)
    },
    onZoomBrowserPage: (callback: (direction: 'in' | 'out' | 'reset') => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, direction: 'in' | 'out' | 'reset') =>
        callback(direction)
      ipcRenderer.on('ui:zoomBrowserPage', listener)
      return () => ipcRenderer.removeListener('ui:zoomBrowserPage', listener)
    },
    onHardReloadBrowserPage: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:hardReloadBrowserPage', listener)
      return () => ipcRenderer.removeListener('ui:hardReloadBrowserPage', listener)
    },
    onCloseActiveTab: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:closeActiveTab', listener)
      return () => ipcRenderer.removeListener('ui:closeActiveTab', listener)
    },
    onCloseFloatingItem: (callback: (payload: { sourceId: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { sourceId: string }) =>
        callback(payload)
      ipcRenderer.on('ui:closeFloatingItem', listener)
      return () => ipcRenderer.removeListener('ui:closeFloatingItem', listener)
    },
    onSelectFloatingIndex: (callback: (payload: { index: number }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { index: number }) =>
        callback(payload)
      ipcRenderer.on('ui:selectFloatingIndex', listener)
      return () => ipcRenderer.removeListener('ui:selectFloatingIndex', listener)
    },
    onSwitchTab: (callback: (direction: 1 | -1) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, direction: 1 | -1) => callback(direction)
      ipcRenderer.on('ui:switchTab', listener)
      return () => ipcRenderer.removeListener('ui:switchTab', listener)
    },
    onSwitchTabAcrossAllTypes: (callback: (direction: 1 | -1) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, direction: 1 | -1) => callback(direction)
      ipcRenderer.on('ui:switchTabAcrossAllTypes', listener)
      return () => ipcRenderer.removeListener('ui:switchTabAcrossAllTypes', listener)
    },
    onSwitchRecentTab: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:switchRecentTab', listener)
      return () => ipcRenderer.removeListener('ui:switchRecentTab', listener)
    },
    onSwitchTerminalTab: (callback: (direction: 1 | -1) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, direction: 1 | -1) => callback(direction)
      ipcRenderer.on('ui:switchTerminalTab', listener)
      return () => ipcRenderer.removeListener('ui:switchTerminalTab', listener)
    },
    onCtrlTabKeyDown: (callback: (data: { shiftKey: boolean }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { shiftKey: boolean }) =>
        callback(data)
      ipcRenderer.on('ui:ctrlTabKeyDown', listener)
      return () => ipcRenderer.removeListener('ui:ctrlTabKeyDown', listener)
    },
    onCtrlTabKeyUp: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:ctrlTabKeyUp', listener)
      return () => ipcRenderer.removeListener('ui:ctrlTabKeyUp', listener)
    },
    onToggleStatusBar: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:toggleStatusBar', listener)
      return () => ipcRenderer.removeListener('ui:toggleStatusBar', listener)
    },
    onExportPdfRequested: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('export:requestPdf', listener)
      return () => ipcRenderer.removeListener('export:requestPdf', listener)
    },
    onAppMenuPaste: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:appMenuPaste', listener)
      return () => ipcRenderer.removeListener('ui:appMenuPaste', listener)
    },
    onEditableContextPaste: (
      callback: (data: { plainTextOnly: boolean }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { plainTextOnly: boolean }
      ): void => callback({ plainTextOnly: data?.plainTextOnly === true })
      ipcRenderer.on('ui:editableContextPaste', listener)
      return () => ipcRenderer.removeListener('ui:editableContextPaste', listener)
    },
    onDictationKeyDown: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:dictationKeyDown', listener)
      return () => ipcRenderer.removeListener('ui:dictationKeyDown', listener)
    },
    onActivateWorktree: (
      callback: (data: {
        repoId: string
        worktreeId: string
        setup?: WorktreeSetupLaunch
        startup?: { command: string; env?: Record<string, string> }
        defaultTabs?: WorktreeDefaultTabsLaunch
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          repoId: string
          worktreeId: string
          setup?: WorktreeSetupLaunch
          startup?: { command: string; env?: Record<string, string> }
          defaultTabs?: WorktreeDefaultTabsLaunch
        }
      ) => callback(data)
      ipcRenderer.on('ui:activateWorktree', listener)
      return () => ipcRenderer.removeListener('ui:activateWorktree', listener)
    },
    onCreateTerminal: (
      callback: (data: {
        requestId?: string
        worktreeId: string
        command?: string
        cwd?: string
        env?: Record<string, string>
        launchConfig?: SleepingAgentLaunchConfig
        resumeProviderSession?: AgentProviderSessionMetadata
        launchToken?: string
        launchAgent?: TuiAgent
        viewMode?: 'terminal' | 'chat'
        title?: string
        ptyId?: string
        activate?: boolean
        focus?: boolean
        presentation?: RuntimeTerminalPresentation
        surfaceOwner?: false
        tabId?: string
        leafId?: string
        splitFromLeafId?: string
        splitDirection?: 'horizontal' | 'vertical'
        splitTelemetrySource?: TerminalPaneSplitSource
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          requestId?: string
          worktreeId: string
          command?: string
          cwd?: string
          env?: Record<string, string>
          launchConfig?: SleepingAgentLaunchConfig
          resumeProviderSession?: AgentProviderSessionMetadata
          launchToken?: string
          launchAgent?: TuiAgent
          viewMode?: 'terminal' | 'chat'
          title?: string
          ptyId?: string
          activate?: boolean
          focus?: boolean
          presentation?: RuntimeTerminalPresentation
          surfaceOwner?: false
          tabId?: string
          leafId?: string
          splitFromLeafId?: string
          splitDirection?: 'horizontal' | 'vertical'
          splitTelemetrySource?: TerminalPaneSplitSource
        }
      ) => callback(data)
      ipcRenderer.on('ui:createTerminal', listener)
      return () => ipcRenderer.removeListener('ui:createTerminal', listener)
    },
    onRequestTerminalCreate: (
      callback: (data: RuntimeTerminalCreateRequestPayload) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: RuntimeTerminalCreateRequestPayload
      ) => callback(data)
      ipcRenderer.on('terminal:requestTabCreate', listener)
      return () => ipcRenderer.removeListener('terminal:requestTabCreate', listener)
    },
    onRequestTerminalTabMount: (
      callback: (data: { worktreeId: string; tabId?: string; ptyId?: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { worktreeId: string; tabId?: string; ptyId?: string }
      ) => callback(data)
      ipcRenderer.on('terminal:requestTabMount', listener)
      return () => ipcRenderer.removeListener('terminal:requestTabMount', listener)
    },
    replyTerminalCreate: (reply: TerminalTabCreateReply): void => {
      ipcRenderer.send('terminal:tabCreateReply', reply)
    },
    onSplitTerminal: (
      callback: (data: {
        tabId: string
        paneRuntimeId: number
        direction: 'horizontal' | 'vertical'
        command?: string
        telemetrySource?: TerminalPaneSplitSource
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          tabId: string
          paneRuntimeId: number
          direction: 'horizontal' | 'vertical'
          command?: string
          telemetrySource?: TerminalPaneSplitSource
        }
      ) => callback(data)
      ipcRenderer.on('ui:splitTerminal', listener)
      return () => ipcRenderer.removeListener('ui:splitTerminal', listener)
    },
    onRenameTerminal: (
      callback: (data: { tabId: string; title: string | null }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { tabId: string; title: string | null }
      ) => callback(data)
      ipcRenderer.on('ui:renameTerminal', listener)
      return () => ipcRenderer.removeListener('ui:renameTerminal', listener)
    },
    onFocusTerminal: (
      callback: (data: {
        tabId: string
        worktreeId: string
        leafId?: string | null
        ackPaneKeyOnSuccess?: string
        flashFocusedPane?: boolean
        scrollToBottomIfOutputSinceLastView?: boolean
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          tabId: string
          worktreeId: string
          leafId?: string | null
          ackPaneKeyOnSuccess?: string
          flashFocusedPane?: boolean
          scrollToBottomIfOutputSinceLastView?: boolean
        }
      ) => callback(data)
      ipcRenderer.on('ui:focusTerminal', listener)
      return () => ipcRenderer.removeListener('ui:focusTerminal', listener)
    },
    onFocusEditorTab: (
      callback: (data: { tabId: string; worktreeId: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { tabId: string; worktreeId: string }
      ) => callback(data)
      ipcRenderer.on('ui:focusEditorTab', listener)
      return () => ipcRenderer.removeListener('ui:focusEditorTab', listener)
    },
    onCloseSessionTab: (
      callback: (data: { tabId: string; worktreeId: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { tabId: string; worktreeId: string }
      ) => callback(data)
      ipcRenderer.on('ui:closeSessionTab', listener)
      return () => ipcRenderer.removeListener('ui:closeSessionTab', listener)
    },
    onMoveSessionTab: (
      callback: (data: { worktreeId: string } & RuntimeMobileSessionTabMove) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { worktreeId: string } & RuntimeMobileSessionTabMove
      ) => callback(data)
      ipcRenderer.on('ui:moveSessionTab', listener)
      return () => ipcRenderer.removeListener('ui:moveSessionTab', listener)
    },
    onOpenFileFromMobile: (
      callback: (data: {
        worktreeId: string
        filePath: string
        relativePath: string
        runtimeEnvironmentId?: string
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          worktreeId: string
          filePath: string
          relativePath: string
          runtimeEnvironmentId?: string
        }
      ) => callback(data)
      ipcRenderer.on('ui:openFileFromMobile', listener)
      return () => ipcRenderer.removeListener('ui:openFileFromMobile', listener)
    },
    onOpenDiffFromMobile: (
      callback: (data: {
        worktreeId: string
        filePath: string
        relativePath: string
        staged: boolean
        runtimeEnvironmentId?: string
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          worktreeId: string
          filePath: string
          relativePath: string
          staged: boolean
          runtimeEnvironmentId?: string
        }
      ) => callback(data)
      ipcRenderer.on('ui:openDiffFromMobile', listener)
      return () => ipcRenderer.removeListener('ui:openDiffFromMobile', listener)
    },
    onMobileMarkdownRequest: (
      callback: (request: RuntimeMobileMarkdownRequest) => void
    ): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, request: RuntimeMobileMarkdownRequest) =>
        callback(request)
      ipcRenderer.on('ui:mobileMarkdownRequest', listener)
      return () => ipcRenderer.removeListener('ui:mobileMarkdownRequest', listener)
    },
    respondMobileMarkdownRequest: (response: RuntimeMobileMarkdownResponse): void => {
      ipcRenderer.send('ui:mobileMarkdownResponse', response)
    },
    onCloseTerminal: (
      callback: (data: { tabId: string; paneRuntimeId?: number }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { tabId: string; paneRuntimeId?: number }
      ) => callback(data)
      ipcRenderer.on('ui:closeTerminal', listener)
      return () => ipcRenderer.removeListener('ui:closeTerminal', listener)
    },
    onTerminalTabCloseRequest: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        request: Parameters<typeof callback>[0]
      ) => callback(request)
      ipcRenderer.on('ui:terminalTabCloseRequest', listener)
      return () => ipcRenderer.removeListener('ui:terminalTabCloseRequest', listener)
    },
    respondTerminalTabClose: (response) => {
      ipcRenderer.send('ui:terminalTabCloseResponse', response)
    },
    onSleepWorktree: (callback: (data: { worktreeId: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { worktreeId: string }) =>
        callback(data)
      ipcRenderer.on('ui:sleepWorktree', listener)
      return () => ipcRenderer.removeListener('ui:sleepWorktree', listener)
    },
    onResumeSleepingAgents: (callback: (data: { worktreeId: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { worktreeId: string }) =>
        callback(data)
      ipcRenderer.on('ui:resumeSleepingAgents', listener)
      return () => ipcRenderer.removeListener('ui:resumeSleepingAgents', listener)
    },
    onTerminalZoom: (callback: (direction: 'in' | 'out' | 'reset') => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, direction: 'in' | 'out' | 'reset') =>
        callback(direction)
      ipcRenderer.on('terminal:zoom', listener)
      return () => ipcRenderer.removeListener('terminal:zoom', listener)
    },
    readClipboardText: (options?: ReadClipboardTextOptions): Promise<string> =>
      ipcRenderer.invoke('clipboard:readText', options),
    readSelectionClipboardText: (options?: ReadClipboardTextOptions): Promise<string> =>
      ipcRenderer.invoke('clipboard:readSelectionText', options),
    saveClipboardImageAsTempFile: (args?: {
      connectionId?: string | null
      runtimeEnvironmentId?: string | null
    }): Promise<string | null> => ipcRenderer.invoke('clipboard:saveImageAsTempFile', args),
    writeClipboardText: (text: string): Promise<void> =>
      ipcRenderer.invoke('clipboard:writeText', text),
    writeTerminalClipboardText: (text: string): Promise<void> =>
      ipcRenderer.invoke('clipboard:writeTerminalText', text),
    writeSelectionClipboardText: (text: string): Promise<void> =>
      ipcRenderer.invoke('clipboard:writeSelectionText', text),
    writeClipboardImage: (dataUrl: string): Promise<void> =>
      ipcRenderer.invoke('clipboard:writeImage', dataUrl),
    performNativePaste: (options?: { mode?: 'paste' | 'paste-and-match-style' }): void => {
      ipcRenderer.send('ui:performNativePaste', {
        mode: options?.mode === 'paste-and-match-style' ? 'paste-and-match-style' : 'paste'
      })
    },
    writeClipboardFile: (
      args:
        | {
            filePath: string
            connectionId?: string | null
          }
        | string
    ): Promise<{ ok: boolean; reason?: string }> => ipcRenderer.invoke('clipboard:writeFile', args),
    onFileDrop: (callback: (data: NativeFileDropPayload) => void): (() => void) =>
      subscribeNativeFileDrop(callback),
    getZoomLevel: (): number => webFrame.getZoomLevel(),
    setZoomLevel: (level: number): void => webFrame.setZoomLevel(level),
    syncTrafficLights: (zoomFactor: number): void =>
      ipcRenderer.send('ui:sync-traffic-lights', zoomFactor),
    // Why: one-way send so main's before-input-event can synchronously skip Cmd+B while the markdown editor is focused (TipTap bold).
    setMarkdownEditorFocused: (focused: boolean): void => {
      ipcRenderer.send('ui:setMarkdownEditorFocused', focused)
    },
    setRichMarkdownContextMenuTarget: (target: RichMarkdownContextMenuTableTarget | null): void => {
      ipcRenderer.send(richMarkdownContextMenuTargetChannel, target)
    },
    setTerminalInputFocused: (focused: boolean): void => {
      ipcRenderer.send('ui:setTerminalInputFocused', focused)
    },
    // Why: one atomic payload so main's synchronous before-input-event never sees a torn terminal=true/panel=false state.
    setFloatingFocus: (state: { panelFocused: boolean; terminalFocused: boolean }): void => {
      ipcRenderer.send('ui:setFloatingFocus', state)
    },
    setShortcutRecorderFocused: (focused: boolean): void => {
      ipcRenderer.send('ui:setShortcutRecorderFocused', focused)
    },
    onRichMarkdownContextCommand: (
      callback: (payload: RichMarkdownContextMenuCommandPayload) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: RichMarkdownContextMenuCommandPayload
      ) => callback(payload)
      ipcRenderer.on(richMarkdownContextMenuCommandChannel, listener)
      return () => ipcRenderer.removeListener(richMarkdownContextMenuCommandChannel, listener)
    },
    onFullscreenChanged: (callback: (isFullScreen: boolean) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, isFullScreen: boolean) =>
        callback(isFullScreen)
      ipcRenderer.on('window:fullscreen-changed', listener)
      return () => ipcRenderer.removeListener('window:fullscreen-changed', listener)
    },
    /** Fired when the OS resumes from sleep — a focus-preserving wake fires no renderer focus/visibility events. */
    onSystemResumed: (callback: () => void): (() => void) => {
      const listener = () => callback()
      ipcRenderer.on('system:resumed', listener)
      return () => ipcRenderer.removeListener('system:resumed', listener)
    },
    /** Desktop custom titlebar only: minimize via renderer-drawn window controls. */
    minimize: (): void => {
      ipcRenderer.send('window:minimize')
    },
    /** Desktop custom titlebar only: toggle maximize/restore via renderer-drawn controls. */
    maximize: (): void => {
      ipcRenderer.send('window:maximize')
    },
    /** Desktop custom titlebar only: read initial maximize state on mount — maximize-changed only fires on transitions. */
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
    /** Desktop custom titlebar only: subscribe to maximize-state changes so the maximize button shows the right icon. */
    onMaximizeChanged: (callback: (isMaximized: boolean) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, isMaximized: boolean) =>
        callback(isMaximized)
      ipcRenderer.on('window:maximize-changed', listener)
      return () => ipcRenderer.removeListener('window:maximize-changed', listener)
    },
    /** Desktop custom titlebar only: request close via main so the BrowserWindow 'close' event
     *  (and its terminal-running guard) still fires — window.close() is unreliable in sandboxed renderers. */
    requestClose: (): void => {
      ipcRenderer.send('window:request-close')
    },
    /** Desktop custom titlebar only: pop up the app menu at the cursor — Alt-reveal replacement for the ··· button. */
    popupMenu: (): void => {
      ipcRenderer.send('menu:popup')
    },
    /** Fired by main when the user tries to close the window; renderer confirms running
     *  terminals then calls confirmWindowClose(). isQuitting (Cmd+Q / app.quit) skips that dialog. */
    onWindowCloseRequested: (callback: (data: { isQuitting: boolean }) => void): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { isQuitting: boolean; requestId?: number }
      ): void => {
        // Why: main cannot reach will-quit while a frozen renderer owns the window close handshake.
        ipcRenderer.send('window:close-request-received', data?.requestId)
        callback({ isQuitting: data?.isQuitting ?? false })
      }
      ipcRenderer.on('window:close-requested', listener)
      return () => ipcRenderer.removeListener('window:close-requested', listener)
    },
    /** Tell the main process to proceed with the window close. */
    confirmWindowClose: (): void => {
      ipcRenderer.send('window:confirm-close')
    },
    /** Report a genuine hidden→visible reveal so main can recover a stale (throttled) layout/compositor surface. */
    notifyWindowRevealed: (): void => {
      ipcRenderer.send('ui:window-revealed')
    }
  } satisfies PreloadApi['ui'],

  stats: {
    getSummary: (): Promise<{
      totalAgentsSpawned: number
      totalPRsCreated: number
      totalAgentTimeMs: number
      firstEventAt: number | null
    }> => ipcRenderer.invoke('stats:summary')
  },

  memory: {
    getSnapshot: (): Promise<MemorySnapshot> => ipcRenderer.invoke('memory:getSnapshot')
  },

  claudeUsage: {
    getScanState: (): Promise<unknown> => ipcRenderer.invoke('claudeUsage:getScanState'),
    setEnabled: (args: { enabled: boolean }): Promise<unknown> =>
      ipcRenderer.invoke('claudeUsage:setEnabled', args),
    refresh: (args?: { force?: boolean }): Promise<unknown> =>
      ipcRenderer.invoke('claudeUsage:refresh', args),
    getSnapshot: (args: { scope: string; range: string; limit?: number }): Promise<unknown> =>
      ipcRenderer.invoke('claudeUsage:getSnapshot', args),
    getSummary: (args: { scope: string; range: string }): Promise<unknown> =>
      ipcRenderer.invoke('claudeUsage:getSummary', args),
    getDaily: (args: { scope: string; range: string }): Promise<unknown> =>
      ipcRenderer.invoke('claudeUsage:getDaily', args),
    getBreakdown: (args: { scope: string; range: string; kind: string }): Promise<unknown> =>
      ipcRenderer.invoke('claudeUsage:getBreakdown', args),
    getRecentSessions: (args: { scope: string; range: string; limit?: number }): Promise<unknown> =>
      ipcRenderer.invoke('claudeUsage:getRecentSessions', args)
  },

  codexUsage: {
    getScanState: (): Promise<unknown> => ipcRenderer.invoke('codexUsage:getScanState'),
    setEnabled: (args: { enabled: boolean }): Promise<unknown> =>
      ipcRenderer.invoke('codexUsage:setEnabled', args),
    refresh: (args?: { force?: boolean }): Promise<unknown> =>
      ipcRenderer.invoke('codexUsage:refresh', args),
    getSnapshot: (args: { scope: string; range: string; limit?: number }): Promise<unknown> =>
      ipcRenderer.invoke('codexUsage:getSnapshot', args),
    getSummary: (args: { scope: string; range: string }): Promise<unknown> =>
      ipcRenderer.invoke('codexUsage:getSummary', args),
    getDaily: (args: { scope: string; range: string }): Promise<unknown> =>
      ipcRenderer.invoke('codexUsage:getDaily', args),
    getBreakdown: (args: { scope: string; range: string; kind: string }): Promise<unknown> =>
      ipcRenderer.invoke('codexUsage:getBreakdown', args),
    getRecentSessions: (args: { scope: string; range: string; limit?: number }): Promise<unknown> =>
      ipcRenderer.invoke('codexUsage:getRecentSessions', args)
  },

  aiVault: {
    listSessions: (args?: AiVaultListArgs): Promise<unknown> =>
      ipcRenderer.invoke('aiVault:listSessions', args),
    cancelListSessions: (args: { requestToken: string }): Promise<void> =>
      ipcRenderer.invoke('aiVault:cancelListSessions', args),
    prepareSessionResume: (args: AiVaultPrepareSessionResumeArgs): Promise<unknown> =>
      ipcRenderer.invoke('aiVault:prepareSessionResume', args),
    listSubagentSessions: (args: AiVaultSubagentListArgs): Promise<unknown> =>
      ipcRenderer.invoke('aiVault:listSubagentSessions', args),
    getFirstUserPrompt: (args: AiVaultFirstUserPromptArgs): Promise<unknown> =>
      ipcRenderer.invoke('aiVault:getFirstUserPrompt', args),
    onWindowFocused: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('aiVault:windowFocused', listener)
      return () => ipcRenderer.removeListener('aiVault:windowFocused', listener)
    }
  },

  nativeChat: {
    readSession: (
      agent: AgentType,
      sessionId: string,
      limit?: number,
      transcriptPath?: string
    ): Promise<NativeChatReadSessionResult> =>
      ipcRenderer.invoke('nativeChat:readSession', { agent, sessionId, limit, transcriptPath }),
    /** Start live tailing; onAppended fires with only newly-appended messages. Returns an unsubscribe fn that closes the watcher. */
    subscribe: (
      args: {
        subscriptionId: string
        agent: AgentType
        sessionId: string
        transcriptPath?: string
        limit?: number
      },
      onFrame: (frame: NativeChatSubscriptionFrame) => void
    ): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: NativeChatAppendedPayload) => {
        if (payload.subscriptionId === args.subscriptionId) {
          onFrame(payload.frame)
        }
      }
      ipcRenderer.on('nativeChat:appended', listener)
      ipcRenderer.send('nativeChat:subscribe', args)
      return () => {
        ipcRenderer.removeListener('nativeChat:appended', listener)
        ipcRenderer.send('nativeChat:unsubscribe', { subscriptionId: args.subscriptionId })
      }
    }
  },

  runtime: {
    syncWindowGraph: (graph: RuntimeSyncWindowGraph): Promise<RuntimeSyncWindowGraphResult> =>
      ipcRenderer.invoke('runtime:syncWindowGraph', graph),
    getStatus: (): Promise<RuntimeStatus> => ipcRenderer.invoke('runtime:getStatus'),
    call: (args: { method: string; params?: unknown }): Promise<RuntimeRpcResponse<unknown>> =>
      ipcRenderer.invoke('runtime:call', args),
    getTerminalFitOverrides: (): Promise<
      { ptyId: string; mode: 'mobile-fit' | 'remote-desktop-fit'; cols: number; rows: number }[]
    > => ipcRenderer.invoke('runtime:getTerminalFitOverrides'),
    getTerminalDrivers: (): Promise<
      {
        ptyId: string
        driver: RuntimeTerminalDriverState
      }[]
    > => ipcRenderer.invoke('runtime:getTerminalDrivers'),
    getBrowserDrivers: (): Promise<
      {
        browserPageId: string
        driver: RuntimeBrowserDriverState
      }[]
    > => ipcRenderer.invoke('runtime:getBrowserDrivers'),
    restoreTerminalFit: (ptyId: string): Promise<{ restored: boolean }> =>
      ipcRenderer.invoke('runtime:restoreTerminalFit', { ptyId }),
    reclaimBrowserForDesktop: (browserPageId: string): Promise<{ reclaimed: boolean }> =>
      ipcRenderer.invoke('runtime:reclaimBrowserForDesktop', { browserPageId }),
    onTerminalFitOverrideChanged: (
      callback: (event: {
        ptyId: string
        mode: 'mobile-fit' | 'remote-desktop-fit' | 'desktop-fit'
        cols: number
        rows: number
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          ptyId: string
          mode: 'mobile-fit' | 'remote-desktop-fit' | 'desktop-fit'
          cols: number
          rows: number
        }
      ) => callback(data)
      ipcRenderer.on('runtime:terminalFitOverrideChanged', listener)
      return () => ipcRenderer.removeListener('runtime:terminalFitOverrideChanged', listener)
    },
    onTerminalDriverChanged: (
      callback: (event: { ptyId: string; driver: RuntimeTerminalDriverState }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          ptyId: string
          driver: RuntimeTerminalDriverState
        }
      ) => callback(data)
      ipcRenderer.on('runtime:terminalDriverChanged', listener)
      return () => ipcRenderer.removeListener('runtime:terminalDriverChanged', listener)
    },
    onNativeChatLaunchDraftResolved: (
      callback: (event: { tabId: string; text: string; createdAt: number }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { tabId: string; text: string; createdAt: number }
      ) => callback(data)
      ipcRenderer.on('runtime:nativeChatLaunchDraftResolved', listener)
      return () => ipcRenderer.removeListener('runtime:nativeChatLaunchDraftResolved', listener)
    },
    onBrowserDriverChanged: (
      callback: (event: { browserPageId: string; driver: RuntimeBrowserDriverState }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          browserPageId: string
          driver: RuntimeBrowserDriverState
        }
      ) => callback(data)
      ipcRenderer.on('runtime:browserDriverChanged', listener)
      return () => ipcRenderer.removeListener('runtime:browserDriverChanged', listener)
    }
  },

  runtimeEnvironments: {
    list: (): Promise<PublicKnownRuntimeEnvironment[]> =>
      ipcRenderer.invoke('runtimeEnvironments:list'),
    addFromPairingCode: (args: {
      name: string
      pairingCode: string
    }): Promise<{ environment: PublicKnownRuntimeEnvironment }> =>
      ipcRenderer.invoke('runtimeEnvironments:addFromPairingCode', args),
    verifyAndAddFromPairingCode: (args: {
      name: string
      pairingCode: string
      allowLoopback?: boolean
    }): Promise<VerifyAndAddRuntimeEnvironmentResult> =>
      ipcRenderer.invoke('runtimeEnvironments:verifyAndAddFromPairingCode', args),
    resolve: (args: { selector: string }): Promise<PublicKnownRuntimeEnvironment> =>
      ipcRenderer.invoke('runtimeEnvironments:resolve', args),
    remove: (args: { selector: string }): Promise<{ removed: PublicKnownRuntimeEnvironment }> =>
      ipcRenderer.invoke('runtimeEnvironments:remove', args),
    disconnect: (args: {
      selector: string
    }): Promise<{ disconnected: PublicKnownRuntimeEnvironment }> =>
      ipcRenderer.invoke('runtimeEnvironments:disconnect', args),
    connect: (args: {
      selector: string
      timeoutMs?: number
    }): Promise<RuntimeRpcResponse<RuntimeStatus>> =>
      ipcRenderer.invoke('runtimeEnvironments:connect', args),
    getStatus: (args: {
      selector: string
      timeoutMs?: number
    }): Promise<RuntimeRpcResponse<RuntimeStatus>> =>
      ipcRenderer.invoke('runtimeEnvironments:getStatus', args),
    retryConnectionsNow: (): Promise<void> =>
      ipcRenderer.invoke('runtimeEnvironments:retryConnectionsNow'),
    call: (args: {
      selector: string
      method: string
      params?: unknown
      timeoutMs?: number
      expectedEnvironmentPairingRevision?: number
    }): Promise<RuntimeRpcResponse<unknown>> =>
      ipcRenderer.invoke('runtimeEnvironments:call', args),
    subscribe: async (
      args: {
        selector: string
        method: string
        params?: unknown
        timeoutMs?: number
        expectedEnvironmentPairingRevision?: number
      },
      callbacks: {
        onResponse: (response: RuntimeRpcResponse<unknown>) => void
        onBinary?: (bytes: Uint8Array<ArrayBufferLike>) => void
        onError?: (error: { code: string; message: string }) => void
        onClose?: () => void
      }
    ): Promise<RuntimeEnvironmentSubscriptionHandle> =>
      subscribeRuntimeEnvironmentFromPreload(ipcRenderer, args, callbacks)
  },

  rateLimits: {
    get: (): Promise<RateLimitState> => ipcRenderer.invoke('rateLimits:get'),
    refresh: (): Promise<RateLimitState> => ipcRenderer.invoke('rateLimits:refresh'),
    refreshCodexForTarget: (target: RateLimitRuntimeTarget): Promise<RateLimitState> =>
      ipcRenderer.invoke('rateLimits:refreshCodexForTarget', target),
    consumeCodexResetCredit: (): Promise<CodexRateLimitResetResult> =>
      ipcRenderer.invoke('rateLimits:consumeCodexResetCredit'),
    refreshClaudeForTarget: (target: RateLimitRuntimeTarget): Promise<RateLimitState> =>
      ipcRenderer.invoke('rateLimits:refreshClaudeForTarget', target),
    setPollingInterval: (ms: number): Promise<void> =>
      ipcRenderer.invoke('rateLimits:setPollingInterval', ms),
    fetchInactiveClaudeAccounts: (): Promise<void> =>
      ipcRenderer.invoke('rateLimits:fetchInactiveClaudeAccounts'),
    fetchInactiveCodexAccounts: (): Promise<void> =>
      ipcRenderer.invoke('rateLimits:fetchInactiveCodexAccounts'),
    onUpdate: (callback: (state: RateLimitState) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: RateLimitState) => callback(state)
      ipcRenderer.on('rateLimits:update', listener)
      return () => ipcRenderer.removeListener('rateLimits:update', listener)
    }
  },

  automations: {
    list: (): Promise<Automation[]> => ipcRenderer.invoke('automations:list'),
    listRuns: (args?: { automationId?: string }): Promise<AutomationRun[]> =>
      ipcRenderer.invoke('automations:listRuns', args),
    listExternalManagers: (): Promise<ExternalAutomationManager[]> =>
      ipcRenderer.invoke('automations:listExternalManagers'),
    listExternalRuns: (input: ExternalAutomationRunsInput): Promise<ExternalAutomationRunsPage> =>
      ipcRenderer.invoke('automations:listExternalRuns', input),
    createExternal: (input: ExternalAutomationCreateInput): Promise<void> =>
      ipcRenderer.invoke('automations:createExternal', input),
    updateExternal: (input: ExternalAutomationUpdateInput): Promise<void> =>
      ipcRenderer.invoke('automations:updateExternal', input),
    runExternalAction: (input: ExternalAutomationActionInput): Promise<void> =>
      ipcRenderer.invoke('automations:runExternalAction', input),
    create: (input: AutomationCreateInput): Promise<Automation> =>
      ipcRenderer.invoke('automations:create', input),
    update: (args: { id: string; updates: AutomationUpdateInput }): Promise<Automation> =>
      ipcRenderer.invoke('automations:update', args),
    delete: (args: { id: string }): Promise<void> => ipcRenderer.invoke('automations:delete', args),
    runNow: (args: { id: string }): Promise<AutomationRun> =>
      ipcRenderer.invoke('automations:runNow', args),
    runPrecheck: (args: {
      automationId: string
      runId: string
    }): Promise<AutomationPrecheckResult | null> =>
      ipcRenderer.invoke('automations:runPrecheck', args),
    markDispatchResult: (result: AutomationDispatchResult): Promise<AutomationRun> =>
      ipcRenderer.invoke('automations:markDispatchResult', result),
    snapshotWorkspaceName: (args: { workspaceId: string; displayName: string }): Promise<number> =>
      ipcRenderer.invoke('automations:snapshotWorkspaceName', args),
    rendererReady: (): Promise<void> => ipcRenderer.invoke('automations:rendererReady'),
    onDispatchRequested: (callback: (request: AutomationDispatchRequest) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, request: AutomationDispatchRequest) =>
        callback(request)
      ipcRenderer.on('automations:dispatchRequested', listener)
      return () => ipcRenderer.removeListener('automations:dispatchRequested', listener)
    }
  },

  e2e: {
    getConfig: () => preloadE2EConfig
  },

  mobile: {
    listNetworkInterfaces: (): Promise<{
      interfaces: { name: string; address: string }[]
    }> => ipcRenderer.invoke('mobile:listNetworkInterfaces'),

    getPairingQR: (args?: {
      address?: string
      connectionMode?: MobilePairingConnectionMode
      rotate?: boolean
    }): Promise<
      | {
          available: false
          reason?: string
          guidance?: string
          relayFailure?: MobileRelayMintFailure
        }
      | {
          available: true
          qrDataUrl: string | null
          qrError?: 'encoding_failed'
          pairingUrl: string
          endpoint: string
          deviceId: string
          connectionMode: MobilePairingConnectionMode
        }
    > => ipcRenderer.invoke('mobile:getPairingQR', args),

    getWindowsFirewallStatus: (args?: { address?: string }) =>
      ipcRenderer.invoke('mobile:getWindowsFirewallStatus', args),

    repairWindowsFirewall: () => ipcRenderer.invoke('mobile:repairWindowsFirewall'),

    openWindowsNetworkSettings: () => ipcRenderer.invoke('mobile:openWindowsNetworkSettings'),

    getRuntimePairingUrl: (args?: {
      address?: string
      rotate?: boolean
      // Why: the widen is one-way and host-wide, so main must gate it on the reach the user picked, not
      // on how the typed address happens to look (a Custom loopback may front an SSH tunnel).
      reach?: RuntimePairingReach
    }): Promise<
      | { available: false; reason?: 'network_exposure_failed'; guidance?: string }
      | {
          available: true
          pairingUrl: string
          webClientUrl: string | null
          endpoint: string
          deviceId: string
        }
    > => ipcRenderer.invoke('mobile:getRuntimePairingUrl', args),

    listDevices: (): Promise<{
      devices: { deviceId: string; name: string; pairedAt: number; lastSeenAt: number }[]
    }> => ipcRenderer.invoke('mobile:listDevices'),

    revokeDevice: (args: { deviceId: string }): Promise<{ revoked: boolean }> =>
      ipcRenderer.invoke('mobile:revokeDevice', args),

    listRuntimeAccessGrants: () => ipcRenderer.invoke('mobile:listRuntimeAccessGrants'),

    revokeRuntimeAccess: (args: { deviceId: string }): Promise<{ revoked: boolean }> =>
      ipcRenderer.invoke('mobile:revokeRuntimeAccess', args),

    isWebSocketReady: (): Promise<{ ready: boolean; endpoint: string | null }> =>
      ipcRenderer.invoke('mobile:isWebSocketReady'),

    getRelayStatus: (): Promise<{ status: MobileRelayStatus }> =>
      ipcRenderer.invoke('mobile:getRelayStatus'),

    onRelayStatusChanged: (callback: (status: MobileRelayStatus) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: MobileRelayStatus) =>
        callback(status)
      ipcRenderer.on('mobile:relayStatusChanged', listener)
      return () => ipcRenderer.removeListener('mobile:relayStatusChanged', listener)
    },

    consumePendingUnpairedDeviceAuthFailure: (): Promise<boolean> =>
      ipcRenderer.invoke('mobile:consumePendingUnpairedDeviceAuthFailure'),

    /** Fires (throttled, once per session) when an unpaired phone repeatedly fails direct-transport auth. */
    onUnpairedDeviceAuthFailure: (callback: () => void): (() => void) => {
      const listener = () => callback()
      ipcRenderer.on('mobile:unpairedDeviceAuthFailure', listener)
      return () => ipcRenderer.removeListener('mobile:unpairedDeviceAuthFailure', listener)
    }
  },

  agentStatus: {
    /** Listen for agent status updates forwarded from native hook receivers. */
    onSet: (callback: (data: AgentStatusIpcPayload) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: AgentStatusIpcPayload) =>
        callback(data)
      ipcRenderer.on('agentStatus:set', listener)
      return () => ipcRenderer.removeListener('agentStatus:set', listener)
    },
    onClear: (callback: (data: AgentStatusClearIpcPayload) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: AgentStatusClearIpcPayload) =>
        callback(data)
      ipcRenderer.on('agentStatus:clear', listener)
      return () => ipcRenderer.removeListener('agentStatus:clear', listener)
    },
    /** Pull cached hook statuses after renderer hydration, so startup replays aren't lost before tabs exist. */
    getSnapshot: (): Promise<AgentStatusIpcPayload[]> =>
      ipcRenderer.invoke('agentStatus:getSnapshot'),
    inferInterrupt: (request: AgentInterruptInferenceRequest): Promise<boolean> =>
      ipcRenderer.invoke('agentStatus:inferInterrupt', request),
    inferQuestionAnswered: (request: AgentQuestionAnsweredInferenceRequest): Promise<boolean> =>
      ipcRenderer.invoke('agentStatus:inferQuestionAnswered', request),
    onMigrationUnsupported: (
      callback: (entry: MigrationUnsupportedPtyEntry) => void
    ): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, entry: MigrationUnsupportedPtyEntry) =>
        callback(entry)
      ipcRenderer.on('agentStatus:migrationUnsupported', listener)
      return () => ipcRenderer.removeListener('agentStatus:migrationUnsupported', listener)
    },
    onMigrationUnsupportedClear: (callback: (data: { ptyId: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { ptyId: string }) =>
        callback(data)
      ipcRenderer.on('agentStatus:migrationUnsupportedClear', listener)
      return () => ipcRenderer.removeListener('agentStatus:migrationUnsupportedClear', listener)
    },
    onLegacyWorkerTerminalRecovery: (
      callback: (data: {
        paneKey: string
        resolution: 'adopted' | 'exited' | 'rolled_back'
        ptyId?: string
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          paneKey: string
          resolution: 'adopted' | 'exited' | 'rolled_back'
          ptyId?: string
        }
      ) => callback(data)
      ipcRenderer.on('agentStatus:legacyWorkerTerminalRecovery', listener)
      return () => ipcRenderer.removeListener('agentStatus:legacyWorkerTerminalRecovery', listener)
    },
    getMigrationUnsupportedSnapshot: (): Promise<MigrationUnsupportedPtyEntry[]> =>
      ipcRenderer.invoke('agentStatus:getMigrationUnsupportedSnapshot'),
    /** Drop the cached hook status for a paneKey on both sides (memory + on-disk) so a relaunch can't resurrect a dismissed row. */
    drop: (paneKey: string): void => {
      ipcRenderer.send('agentStatus:drop', paneKey)
    },
    /** Drop all cached hook statuses under one terminal tab prefix; fired on explicit tab close even without a local row. */
    dropByTabPrefix: (tabId: string): void => {
      ipcRenderer.send('agentStatus:dropByTabPrefix', tabId)
    },
    retirePaneAuthority: (paneKey: string): void => {
      ipcRenderer.send('agentStatus:retirePaneAuthority', paneKey)
    },
    transferPaneAuthority: (args: {
      fromPaneKey: string
      toPaneKey: string
      ptyId?: string
    }): void => {
      ipcRenderer.send('agentStatus:transferPaneAuthority', args)
    }
  }
}

// Expose Electron APIs via contextBridge when context-isolated, otherwise attach to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
