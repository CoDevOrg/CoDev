/* oxlint-disable max-lines */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
// Why: this registry mirrors the Settings sidebar in one neutral module so
// Cmd+J and Settings visibility cannot drift. Keep it free of Settings pane UI
// imports; the boundary is enforced by a focused architecture test.
import {
  Bell,
  Blocks,
  Bot,
  Bug,
  FlaskConical,
  GitBranch,
  Globe,
  Keyboard,
  Lock,
  Network,
  Palette,
  PanelsTopLeft,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  TabletSmartphone,
  SquareTerminal,
  TextCursorInput,
  UserCog,
  Wrench
} from 'lucide-react'
import type { Repo } from '../../../shared/types'
import { getRepoKindLabel } from '../../../shared/repo-kind'
import { useAppStore } from '@/store'
import { isMacUserAgent, isWindowsUserAgent } from '@/components/terminal-pane/pane-helpers'
import type { SettingsNavSection } from '@/lib/settings-navigation-types'
import { getGeneralPaneSearchEntries } from '@/components/settings/general-search'
import { getAgentsPaneSearchEntries } from '@/components/settings/agents-search'
import { getAccountsPaneSearchEntries } from '@/components/settings/accounts-search'
import { getCodevAccountsSearchEntries } from '@/components/settings/codev-accounts-search'
import { filterCodevEmbeddedSettingsSections } from '@/components/settings/codev-personal-settings'
import { getIntegrationsPaneSearchEntries } from '@/components/settings/integrations-search'
import { getGitPaneSearchEntries } from '@/components/settings/git-search'
import { getGitProviderApiBudgetSearchEntries } from '@/components/settings/git-provider-api-budget-search'
import { getCommitMessageAiPaneSearchEntries } from '@/components/settings/commit-message-ai-search'
import { getFloatingWorkspaceSearchEntries } from '@/components/settings/floating-workspace-search'
import { getAppearancePaneSearchEntries } from '@/components/settings/appearance-search'
import { getInputPaneSearchEntries } from '@/components/settings/input-search'
import { getTerminalPaneSearchEntries } from '@/components/settings/terminal-search'
import { getBrowserPaneCombinedSearchEntries } from '@/components/settings/browser-pane-search'
import { getNotificationsPaneSearchEntries } from '@/components/settings/notifications-search'
import { getOrchestrationPaneSearchEntries } from '@/components/settings/orchestration-search'
import {
  getRuntimeEnvironmentsSearchEntry,
  getWebRuntimeEnvironmentsSearchEntry
} from '@/components/settings/runtime-environments-search'
import { getMobileEmulatorSearchEntries } from '@/components/settings/mobile-emulator-search'
import { getDeveloperPermissionsPaneSearchEntries } from '@/components/settings/developer-permissions-search'
import { getPrivacyPaneSearchEntries } from '@/components/settings/privacy-search'
import { getAdvancedPaneSearchEntries } from '@/components/settings/advanced-search'
import { getShortcutsPaneSearchEntries } from '@/components/settings/shortcuts-search'
import { getExperimentalPaneSearchEntries } from '@/components/settings/experimental-search'
import { getPluginsPaneSearchEntries } from '@/components/settings/plugins-search'
import { getRepositoryPaneSearchEntries } from '@/components/settings/repository-search'
import { buildSettingsProjectList } from '@/components/settings/settings-project-list'
import { isWebClientLocation } from '@/lib/web-client-location'
import {
  isWindowsTerminalCapabilityHost,
  useWindowsTerminalCapabilities
} from '@/lib/windows-terminal-capabilities'
import { useWindowsTerminalCapabilityOwnerKey } from './useWindowsTerminalCapabilityOwnerKey'
import { getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { translate } from '@/i18n/i18n'

export { isWebClientLocation } from '@/lib/web-client-location'

function getDevToolsPaneSearchEntries(): SettingsNavSection['searchEntries'] {
  return [
    {
      title: translate(
        'auto.hooks.useSettingsNavigationMetadata.devSearchNotificationPlayground',
        'Notification playground'
      ),
      description: translate(
        'auto.hooks.useSettingsNavigationMetadata.devSearchNotificationPlaygroundDescription',
        'Trigger representative toast and notification UI states.'
      ),
      keywords: [
        translate('auto.hooks.useSettingsNavigationMetadata.devSearchKeywordDev', 'dev'),
        translate('auto.hooks.useSettingsNavigationMetadata.devSearchKeywordToast', 'toast'),
        translate('auto.hooks.useSettingsNavigationMetadata.devSearchKeywordSonner', 'sonner'),
        translate('auto.hooks.useSettingsNavigationMetadata.devSearchKeywordError', 'error'),
        translate(
          'auto.hooks.useSettingsNavigationMetadata.devSearchKeywordNotification',
          'notification'
        )
      ]
    }
  ]
}

export function buildSettingsNavigationMetadata({
  isMac,
  isWindows,
  isLocalWindowsHost = isWindows,
  isWindowsTerminalHost = isWindows,
  isWebClient,
  isDev = import.meta.env.DEV,
  isCodevEmbedded = false,
  repos
}: {
  isMac: boolean
  isWindows: boolean
  isLocalWindowsHost?: boolean
  isWindowsTerminalHost?: boolean
  isWebClient: boolean
  isDev?: boolean
  isCodevEmbedded?: boolean
  repos: readonly Repo[]
}): SettingsNavSection[] {
  const showDesktopOnlySettings = !isWebClient
  const terminalPaneSearchEntries = getTerminalPaneSearchEntries({
    isWindows,
    isWindowsTerminalHost,
    isMac
  })
  const runtimeEnvironmentsSearchEntry = isWebClient
    ? getWebRuntimeEnvironmentsSearchEntry()
    : getRuntimeEnvironmentsSearchEntry()
  const reposById = new Map<string, Repo>()
  for (const repo of repos) {
    if (!reposById.has(repo.id)) {
      reposById.set(repo.id, repo)
    }
  }

  const sections: SettingsNavSection[] = [
    // Why: this array's order must mirror SETTINGS_NAV_GROUPS so the Settings
    // sidebar and the Cmd+J palette both read top-to-bottom in the same grouped
    // order — keep each new entry beside its group's siblings.
    {
      id: 'agents',
      title: translate('auto.hooks.useSettingsNavigationMetadata.b49abbd2f7', 'Agents'),
      description: translate(
        'auto.hooks.useSettingsNavigationMetadata.4121f7a0a2',
        'Manage AI agents, set a default, and customize commands.'
      ),
      icon: Bot,
      searchEntries: getAgentsPaneSearchEntries({ includeAgentRuntime: isLocalWindowsHost }),
      group: 'capabilities'
    },
    {
      id: 'accounts',
      title: translate(
        'auto.hooks.useSettingsNavigationMetadata.f70ac54d38',
        'AI Provider Accounts'
      ),
      description: isCodevEmbedded
        ? 'Connect the accounts your agents run on. Chat rooms and coding workspaces are set up separately.'
        : translate(
            'auto.hooks.useSettingsNavigationMetadata.b1c2f8b0ac',
            'Optional account switching and usage setup for Claude, Codex, Gemini, OpenCode Go, MiniMax, and Grok.'
          ),
      icon: UserCog,
      searchEntries: isCodevEmbedded
        ? getCodevAccountsSearchEntries()
        : getAccountsPaneSearchEntries(),
      group: 'capabilities',
      badge: translate('auto.hooks.useSettingsNavigationMetadata.7c79d3b7bf', 'Optional')
    },
    {
      id: 'orchestration',
      title: translate('auto.hooks.useSettingsNavigationMetadata.58a868e8e4', 'Orchestration'),
      description: translate(
        'auto.hooks.useSettingsNavigationMetadata.cd50cec5d7',
        'Coordinate multiple coding agents through Orca.'
      ),
      icon: Network,
      searchEntries: getOrchestrationPaneSearchEntries(),
      group: 'capabilities'
    },
    {
      id: 'general',
      title: translate('auto.hooks.useSettingsNavigationMetadata.13241992bd', 'General'),
      description: translate(
        'auto.hooks.useSettingsNavigationMetadata.2cd4ea75da',
        'Workspace defaults, app setup, and maintenance.'
      ),
      icon: SlidersHorizontal,
      searchEntries: getGeneralPaneSearchEntries({ includeProjectRuntime: isLocalWindowsHost }),
      group: 'setup'
    },
    {
      id: 'integrations',
      title: translate('auto.hooks.useSettingsNavigationMetadata.2b043783ef', 'Integrations'),
      description: translate(
        'auto.hooks.useSettingsNavigationMetadata.33a5e1d597',
        'Connect GitHub and source-hosting services.'
      ),
      icon: Blocks,
      searchEntries: getIntegrationsPaneSearchEntries(),
      group: 'setup'
    },
    {
      id: 'git',
      title: translate(
        'auto.hooks.useSettingsNavigationMetadata.09607cb0fe',
        'Git & Source Control'
      ),
      description: translate(
        'auto.hooks.useSettingsNavigationMetadata.ab4b21b58e',
        'Branch naming, base refs, attribution, and Git AI Author.'
      ),
      icon: GitBranch,
      // Why: Git AI Author is rendered inside Git, so shared
      // metadata must search both surfaces wherever Git appears.
      searchEntries: [
        ...getGitPaneSearchEntries(),
        ...getCommitMessageAiPaneSearchEntries(),
        ...getGitProviderApiBudgetSearchEntries()
      ],
      group: 'workflows'
    },
    {
      id: 'terminal',
      title: translate('auto.hooks.useSettingsNavigationMetadata.a9fb10afca', 'Terminal'),
      description: translate(
        'auto.hooks.useSettingsNavigationMetadata.c33bfd664c',
        'Shells, renderer, sessions, and terminal behavior.'
      ),
      icon: SquareTerminal,
      searchEntries: terminalPaneSearchEntries,
      group: 'workflows'
    },
    ...(showDesktopOnlySettings
      ? [
          {
            id: 'browser',
            title: translate('auto.hooks.useSettingsNavigationMetadata.8c197f74a1', 'Browser'),
            description: translate(
              'auto.hooks.useSettingsNavigationMetadata.e815fd01bd',
              'Home page, link routing, and session cookies.'
            ),
            icon: Globe,
            searchEntries: getBrowserPaneCombinedSearchEntries(),
            group: 'workflows'
          }
        ]
      : []),
    ...(showDesktopOnlySettings
      ? [
          {
            id: 'mobile-emulator',
            title: translate(
              'auto.hooks.useSettingsNavigationMetadata.1e761cff2b',
              'Mobile Emulator'
            ),
            description: translate(
              'auto.hooks.useSettingsNavigationMetadata.3d65d3f1b9',
              'Configure mobile emulator support for Orca and coding agents.'
            ),
            icon: TabletSmartphone,
            searchEntries: getMobileEmulatorSearchEntries(),
            group: 'workflows'
          }
        ]
      : []),
    ...(showDesktopOnlySettings
      ? [
          {
            id: 'floating-workspace',
            title: translate(
              'auto.hooks.useSettingsNavigationMetadata.65b19f5bde',
              'Floating Workspace'
            ),
            description: translate(
              'auto.hooks.useSettingsNavigationMetadata.2d0659f6f0',
              'Global terminal, browser, and markdown tabs.'
            ),
            icon: PanelsTopLeft,
            searchEntries: getFloatingWorkspaceSearchEntries(),
            group: 'workflows'
          }
        ]
      : []),
    {
      id: 'appearance',
      title: translate('auto.hooks.useSettingsNavigationMetadata.93d88d20bf', 'Appearance'),
      description: translate(
        'auto.hooks.useSettingsNavigationMetadata.b11a5a48a2',
        'Theme, zoom, app and terminal appearance, sidebars, and status bar.'
      ),
      icon: Palette,
      searchEntries: getAppearancePaneSearchEntries({
        showWarpImport: showDesktopOnlySettings,
        showGhosttyImport: showDesktopOnlySettings,
        showAppIcon: showDesktopOnlySettings,
        showSystemTray: showDesktopOnlySettings && isWindows,
        showMenuBarIcon: showDesktopOnlySettings && isMac
      }),
      group: 'interface'
    },
    {
      id: 'input',
      title: translate('auto.hooks.useSettingsNavigationMetadata.0c6ee88a5f', 'Input & Editing'),
      description: translate(
        'auto.hooks.useSettingsNavigationMetadata.1f452cbd4c',
        'Selection and editing behavior.'
      ),
      icon: TextCursorInput,
      searchEntries: getInputPaneSearchEntries(),
      group: 'interface'
    },
    ...(showDesktopOnlySettings
      ? [
          {
            id: 'notifications',
            title: translate(
              'auto.hooks.useSettingsNavigationMetadata.2eece16ad1',
              'Notifications'
            ),
            description: translate(
              'auto.hooks.useSettingsNavigationMetadata.7682607591',
              'Native desktop notifications for agent and terminal events.'
            ),
            icon: Bell,
            searchEntries: getNotificationsPaneSearchEntries(),
            group: 'interface'
          }
        ]
      : []),
    {
      id: 'shortcuts',
      title: translate('auto.hooks.useSettingsNavigationMetadata.94295ebfb3', 'Shortcuts'),
      description: translate(
        'auto.hooks.useSettingsNavigationMetadata.dcd0d9b74f',
        'Keyboard shortcuts for common actions.'
      ),
      icon: Keyboard,
      searchEntries: getShortcutsPaneSearchEntries(),
      group: 'interface'
    },
    {
      id: 'servers',
      title: translate(
        'auto.hooks.useSettingsNavigationMetadata.de0c2907a1',
        'Remote Orca Servers'
      ),
      description: isWebClient
        ? 'Connect this browser to a saved Orca server.'
        : 'Pair remote Orca runtimes for persistent sessions, richer remote state, and web or mobile handoff.',
      icon: Server,
      searchEntries: [runtimeEnvironmentsSearchEntry],
      group: 'remote',
      badge: translate('auto.hooks.useSettingsNavigationMetadata.40d80bad8a', 'Beta')
    },
    ...(showDesktopOnlySettings && isMac
      ? [
          {
            id: 'developer-permissions',
            title: translate(
              'auto.hooks.useSettingsNavigationMetadata.d91ae31fbd',
              'macOS Permissions'
            ),
            description: translate(
              'auto.hooks.useSettingsNavigationMetadata.65ec7d1968',
              'macOS privacy access for terminal-launched developer tools.'
            ),
            icon: ShieldCheck,
            searchEntries: getDeveloperPermissionsPaneSearchEntries(),
            group: 'security'
          }
        ]
      : []),
    {
      id: 'privacy',
      title: translate(
        'auto.hooks.useSettingsNavigationMetadata.3618579df6',
        'Privacy & Telemetry'
      ),
      description: translate(
        'auto.hooks.useSettingsNavigationMetadata.8400cfe1c1',
        'Anonymous usage data and telemetry controls.'
      ),
      icon: Lock,
      searchEntries: getPrivacyPaneSearchEntries(),
      group: 'security'
    },
    ...(showDesktopOnlySettings
      ? [
          {
            id: 'advanced',
            title: translate('auto.hooks.useSettingsNavigationMetadata.580a04cd81', 'Advanced'),
            description: translate(
              'auto.hooks.useSettingsNavigationMetadata.e338c507c1',
              'Low-level compatibility settings for troubleshooting.'
            ),
            icon: Wrench,
            searchEntries: getAdvancedPaneSearchEntries(),
            group: 'advanced'
          }
        ]
      : []),
    // Why: dev tooling must not be reachable from packaged/web builds even if
    // this pure metadata builder is called manually with isDev=true.
    ...(showDesktopOnlySettings && import.meta.env.DEV && isDev
      ? [
          {
            id: 'dev',
            title: translate('auto.hooks.useSettingsNavigationMetadata.dev', 'Dev Tools'),
            description: translate(
              'auto.hooks.useSettingsNavigationMetadata.devDescription',
              'Dev-only tools for exercising UI states.'
            ),
            // Why: distinct from the sibling Advanced section's Wrench so the two
            // entries in the same 'advanced' group stay visually distinguishable.
            icon: Bug,
            searchEntries: getDevToolsPaneSearchEntries(),
            group: 'advanced',
            badge: translate('auto.hooks.useSettingsNavigationMetadata.devBadge', 'Dev')
          }
        ]
      : []),
    {
      id: 'experimental',
      title: translate('auto.hooks.useSettingsNavigationMetadata.225071c560', 'Experimental'),
      description: translate(
        'auto.hooks.useSettingsNavigationMetadata.4a728cd56b',
        'New features that are still taking shape. Give them a try.'
      ),
      icon: FlaskConical,
      searchEntries: getExperimentalPaneSearchEntries(),
      group: 'experimental'
    },
    ...(showDesktopOnlySettings
      ? [
          {
            id: 'plugins',
            title: translate('auto.hooks.useSettingsNavigationMetadata.pluginsTitle', 'Plugins'),
            description: translate(
              'auto.hooks.useSettingsNavigationMetadata.pluginsDescription',
              'Install and manage experimental Orca plugins.'
            ),
            icon: Blocks,
            searchEntries: getPluginsPaneSearchEntries(),
            group: 'experimental'
          }
        ]
      : []),
    // Why: one nav row per project, not per repo row — a project set up on
    // multiple hosts (local + a Remote Orca Server, or two clones) collapses to
    // a single entry. Derived from repos alone so this list matches the panes.
    ...buildSettingsProjectList(repos).map(({ project, representativeRepoId, setups }) => {
      const representativeRepo = reposById.get(representativeRepoId) ?? repos[0]
      const hostSummary =
        setups.length > 1
          ? translate(
              'auto.hooks.useSettingsNavigationMetadata.projectHostsSummary',
              '{{value0}} hosts',
              { value0: setups.length }
            )
          : (setups[0]?.path ?? representativeRepo.path)
      return {
        id: `repo-${representativeRepoId}`,
        title: project.displayName,
        description: `${getRepoKindLabel(project)} • ${hostSummary}`,
        icon: SlidersHorizontal,
        searchEntries: getRepositoryPaneSearchEntries(representativeRepo, {
          windowsRuntimeSupported: isWindowsTerminalHost
        }),
        group: 'repositories'
      }
    })
  ]

  return filterCodevEmbeddedSettingsSections(sections, isCodevEmbedded)
}

export function useSettingsNavigationMetadata(): SettingsNavSection[] {
  // Why: useTranslation subscribes to language changes, but the active locale
  // must also be a memo dependency below — a rerender alone returns the cached
  // previous-language sections, leaving the Settings sidebar and Cmd+J palette
  // stuck in the old language until Settings is remounted.
  const { i18n } = useTranslation()
  const activeLocale = i18n.language
  const repos = useAppStore((state) => state.repos)
  const settings = useAppStore((state) => state.settings)
  const isMac = isMacUserAgent()
  const isWindows = isWindowsUserAgent()
  const isWebClient = isWebClientLocation()
  const isCodevEmbedded = Boolean(window.__CODEV_EMBEDDED__)
  const windowsTerminalCapabilityOwnerKey = useWindowsTerminalCapabilityOwnerKey(
    settings?.activeRuntimeEnvironmentId
  )
  const runtimeTarget = getActiveRuntimeTarget(settings)
  const capabilityLoadTarget = isWebClient ? { kind: 'local' as const } : runtimeTarget
  const windowsTerminalCapabilities = useWindowsTerminalCapabilities(
    isWindows || isWebClient || runtimeTarget.kind === 'environment',
    false,
    windowsTerminalCapabilityOwnerKey,
    capabilityLoadTarget
  )
  const isLocalWindowsHost = isWindowsTerminalCapabilityHost({
    isWindowsRenderer: isWindows,
    isWebClient,
    target: { kind: 'local' },
    hostPlatform:
      isWebClient || runtimeTarget.kind === 'local'
        ? windowsTerminalCapabilities.hostPlatform
        : null
  })
  const isWindowsTerminalHost = isWindowsTerminalCapabilityHost({
    isWindowsRenderer: isWindows,
    isWebClient,
    target: runtimeTarget,
    hostPlatform: windowsTerminalCapabilities.hostPlatform
  })

  // Why: Settings and Cmd+J share this metadata so platform/runtime visibility
  // and search entries cannot drift. Keep this hook free of Settings pane UI
  // imports; see docs/reference/cmd-j-settings-actions-plan.md.
  return useMemo(
    () =>
      buildSettingsNavigationMetadata({
        isMac,
        isWindows,
        isLocalWindowsHost,
        isWindowsTerminalHost,
        isWebClient,
        isDev: import.meta.env.DEV,
        isCodevEmbedded,
        repos
      }),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- activeLocale is read implicitly by the translate() calls inside buildSettingsNavigationMetadata; without it the memo keeps the previous language's sections.
    [
      isMac,
      isWindows,
      isLocalWindowsHost,
      isWindowsTerminalHost,
      isWebClient,
      isCodevEmbedded,
      repos,
      activeLocale
    ]
  )
}
