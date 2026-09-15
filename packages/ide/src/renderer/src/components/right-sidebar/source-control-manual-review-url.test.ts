import { describe, expect, it } from 'vitest'
import {
  buildSourceControlManualReviewUrl,
  resolveSourceControlManualReviewProvider
} from './source-control-manual-review-url'

describe('resolveSourceControlManualReviewProvider', () => {

  it('returns null when there is no provider hint', () => {
    expect(resolveSourceControlManualReviewProvider({})).toBeNull()
  })
})

describe('buildSourceControlManualReviewUrl', () => {
  it('builds a GitHub compare URL for the current remote branch', () => {
    expect(
      buildSourceControlManualReviewUrl({
        baseRef: 'refs/remotes/origin/main',
        branchName: 'native-chat-does-not-auto-open',
        repoRemoteName: 'origin',
        repoRemoteUrl: 'git@github.com:stablyai/orca.git',
        upstreamName: 'origin/native-chat-does-not-auto-open'
      })
    ).toBe(
      'https://github.com/stablyai/orca/compare/main...native-chat-does-not-auto-open?expand=1'
    )
  })

  it('qualifies GitHub fork heads when the push target remote differs from the base repo', () => {
    expect(
      buildSourceControlManualReviewUrl({
        baseRef: 'refs/remotes/upstream/main',
        branchName: 'feature/fork-head',
        repoRemoteName: 'upstream',
        repoRemoteUrl: 'https://github.com/stablyai/orca.git',
        pushTarget: {
          remoteName: 'fork',
          branchName: 'feature/fork-head',
          remoteUrl: 'git@github.com:contributor/orca.git'
        }
      })
    ).toBe('https://github.com/stablyai/orca/compare/main...contributor:feature/fork-head?expand=1')
  })

  it('keeps slashes literal in a GitHub compare URL for a slash-containing branch name', () => {
    expect(
      buildSourceControlManualReviewUrl({
        baseRef: 'refs/remotes/origin/main',
        branchName: 'slashdevcorpse/identifying-pwsh.exe-error',
        repoRemoteName: 'origin',
        repoRemoteUrl: 'git@github.com:stablyai/orca.git',
        upstreamName: 'origin/slashdevcorpse/identifying-pwsh.exe-error'
      })
    ).toBe(
      'https://github.com/stablyai/orca/compare/main...slashdevcorpse/identifying-pwsh.exe-error?expand=1'
    )
  })

  it('suppresses the link when the branch tracks a fork remote with no resolvable push URL', () => {
    // Repro: branch pushed only to a fork (tracked via plain git, so pushTarget
    // is empty). A base-repo compare/main...quick-commands would 404 on origin.
    expect(
      buildSourceControlManualReviewUrl({
        baseRef: 'refs/remotes/origin/main',
        branchName: 'quick-commands',
        repoRemoteName: 'origin',
        repoRemoteUrl: 'https://github.com/stablyai/orca.git',
        upstreamName: 'pr-devajmeireles-orca/quick-commands'
      })
    ).toBeNull()
  })

  it('uses the pushed upstream branch name when the local branch tracks a differently named branch on the base remote', () => {
    expect(
      buildSourceControlManualReviewUrl({
        baseRef: 'refs/remotes/origin/main',
        branchName: 'local-wip-name',
        repoRemoteName: 'origin',
        repoRemoteUrl: 'git@github.com:stablyai/orca.git',
        upstreamName: 'origin/feature/pushed-name'
      })
    ).toBe('https://github.com/stablyai/orca/compare/main...feature/pushed-name?expand=1')
  })

  it('still qualifies the fork head when Orca resolved the fork push URL', () => {
    expect(
      buildSourceControlManualReviewUrl({
        baseRef: 'refs/remotes/origin/main',
        branchName: 'quick-commands',
        repoRemoteName: 'origin',
        repoRemoteUrl: 'https://github.com/stablyai/orca.git',
        upstreamName: 'pr-devajmeireles-orca/quick-commands',
        pushTarget: {
          remoteName: 'pr-devajmeireles-orca',
          branchName: 'quick-commands',
          remoteUrl: 'git@github.com:devajmeireles/orca.git'
        }
      })
    ).toBe('https://github.com/stablyai/orca/compare/main...devajmeireles:quick-commands?expand=1')
  })

  it('does not guess a provider for unknown hosts without a provider hint', () => {
    expect(
      buildSourceControlManualReviewUrl({
        baseRef: 'refs/remotes/origin/main',
        branchName: 'feature/unknown',
        repoRemoteName: 'origin',
        repoRemoteUrl: 'git@git.company.test:team/orca.git',
        upstreamName: 'origin/feature/unknown'
      })
    ).toBeNull()
  })

  it('suppresses the link when the branch was never pushed (no upstream, no push target)', () => {
    // Repro: local-only branch. main...<local-branch> lands on GitHub's
    // "There isn't anything to compare" page.
    expect(
      buildSourceControlManualReviewUrl({
        baseRef: 'refs/remotes/origin/main',
        branchName: 'codex-runtime-home-refactor-design',
        repoRemoteName: 'origin',
        repoRemoteUrl: 'git@github.com:stablyai/orca.git',
        upstreamName: null
      })
    ).toBeNull()
  })
})
