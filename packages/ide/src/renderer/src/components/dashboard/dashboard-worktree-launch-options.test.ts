import { describe, expect, it } from 'vitest'
import { DASHBOARD_MAX_LAUNCH_WORKTREES } from '../../../../shared/dashboard-snapshot'
import type { DashboardCard, DashboardWorkspace } from '../../../../shared/dashboard-snapshot'
import { } from '../../../../shared/workspace-scope'
import { buildDashboardWorktreeLaunchOptions } from './dashboard-worktree-launch-options'

type LaunchState = Parameters<typeof buildDashboardWorktreeLaunchOptions>[0]

function state(overrides: Partial<LaunchState> = {}): LaunchState {
  return {
    repos: [],
    worktreesByRepo: {},
    folderWorkspaces: [],
    projectGroups: [],
    detectedAgentIds: [],
    runtimeDetectedAgentIds: {},
    settings: null,
    ...overrides
  }
}

function card(overrides: Partial<DashboardCard> = {}): DashboardCard {
  return {
    paneKey: 'pane-1',
    ptyId: 'pty-1',
    agentType: 'codex',
    bucket: 'working',
    dotState: 'working',
    task: 'Ship it',
    repoId: 'repo-1',
    worktreeId: 'worktree-1',
    tabId: 'tab-1',
    leafId: 'leaf-1',
    repoName: 'Orca',
    worktreeName: 'Dashboard',
    startedAt: 1,
    finishedAt: null,
    stateChangedAt: 1,
    unseen: false,
    ...overrides
  }
}

describe('buildDashboardWorktreeLaunchOptions', () => {
  it('stops at the bound the snapshot validator enforces', () => {
    const cards = Array.from({ length: DASHBOARD_MAX_LAUNCH_WORKTREES + 25 }, (_unused, index) =>
      card({ paneKey: `pane-${index}`, worktreeId: `worktree-${index}` })
    )

    const options = buildDashboardWorktreeLaunchOptions(
      state({ detectedAgentIds: ['codex'] }),
      cards
    )

    expect(Object.keys(options)).toHaveLength(DASHBOARD_MAX_LAUNCH_WORKTREES)
  })

  it('publishes detected launch choices for workspaces without cards', () => {
    const workspace: DashboardWorkspace = {
      repoId: 'repo-1',
      worktreeId: 'empty-worktree',
      repoName: 'Orca',
      worktreeName: 'Empty',
      hostKind: 'local',
      executionHostId: 'local',
      workspaceKind: 'worktree'
    }
    const options = buildDashboardWorktreeLaunchOptions(
      state({ detectedAgentIds: ['claude', 'codex'] }),
      [],
      [workspace]
    )

    expect(options).toEqual({ 'empty-worktree': ['claude', 'codex'] })
  })

})
