import { describe, expect, it } from 'vitest'
import type {
  ProviderRateLimits,
  ProviderRateLimitStatus
} from '../../../../shared/rate-limit-types'
import {
  getVisibleUsageProvider,
  hasUsageProviderSettings,
  hasUsageProviderSettingsForProvider,
  isUsageEmptyState,
  isProviderConfigured,
  type UsageProviderSettings
} from './status-bar-provider-visibility'

function provider(
  status: ProviderRateLimitStatus,
  overrides: Partial<ProviderRateLimits> = {}
): ProviderRateLimits {
  return {
    provider: 'claude',
    session: null,
    weekly: null,
    updatedAt: 0,
    error: null,
    status,
    ...overrides
  }
}

const CODEX_ACCOUNT = {
  id: 'codex-account-1',
  email: 'dev@example.com',
  managedHomePath: '/tmp/codex-account-1',
  createdAt: 1,
  updatedAt: 1,
  lastAuthenticatedAt: 1
}

const CLAUDE_ACCOUNT = {
  id: 'claude-account-1',
  email: 'dev@example.com',
  managedAuthPath: '/tmp/claude-account-1',
  authMethod: 'subscription-oauth' as const,
  createdAt: 1,
  updatedAt: 1,
  lastAuthenticatedAt: 1
}

describe('isProviderConfigured', () => {
  it('hides a provider whose state has not loaded yet', () => {
    expect(isProviderConfigured(null)).toBe(false)
    expect(isProviderConfigured(undefined)).toBe(false)
  })

  it('hides an unconfigured (unavailable) provider', () => {
    // Why: Claude on API-key billing returns a non-null `unavailable` object,
    // which must not slip past the gate and render a "--" bar.
    expect(isProviderConfigured(provider('unavailable'))).toBe(false)
  })

  it('hides a first-load fetching provider until it has proven usage data', () => {
    expect(isProviderConfigured(provider('fetching'))).toBe(false)
  })

  it('shows configured providers, including ones failing transiently', () => {
    expect(isProviderConfigured(provider('ok'))).toBe(true)
    expect(isProviderConfigured(provider('error'))).toBe(true)
    expect(
      isProviderConfigured(
        provider('fetching', {
          session: {
            usedPercent: 25,
            windowMinutes: 300,
            resetsAt: null,
            resetDescription: null
          }
        })
      )
    ).toBe(true)
    expect(isProviderConfigured(provider('idle'))).toBe(true)
  })
})

function usageSettings(overrides: Partial<UsageProviderSettings> = {}): UsageProviderSettings {
  return {
    codexManagedAccounts: [],
    claudeManagedAccounts: [],
    ...overrides
  }
}

describe('hasUsageProviderSettings', () => {
  it('treats persisted managed accounts as configured usage providers', () => {
    expect(hasUsageProviderSettings(usageSettings({ codexManagedAccounts: [CODEX_ACCOUNT] }))).toBe(
      true
    )
    expect(
      hasUsageProviderSettings(usageSettings({ claudeManagedAccounts: [CLAUDE_ACCOUNT] }))
    ).toBe(true)
  })

  it('does not treat empty or unloaded settings as configured', () => {
    expect(hasUsageProviderSettings(usageSettings())).toBe(false)
    expect(hasUsageProviderSettings(null)).toBe(false)
  })
})

describe('hasUsageProviderSettingsForProvider', () => {
  it('checks durable configuration for a single provider', () => {
    expect(
      hasUsageProviderSettingsForProvider(
        'claude',
        usageSettings({ claudeManagedAccounts: [CLAUDE_ACCOUNT] })
      )
    ).toBe(true)
    expect(
      hasUsageProviderSettingsForProvider(
        'codex',
        usageSettings({ claudeManagedAccounts: [CLAUDE_ACCOUNT] })
      )
    ).toBe(false)
    expect(
      hasUsageProviderSettingsForProvider('codex', usageSettings({ codexManagedAccounts: [CODEX_ACCOUNT] }))
    ).toBe(true)
    expect(hasUsageProviderSettingsForProvider('claude', usageSettings())).toBe(false)
    expect(hasUsageProviderSettingsForProvider('claude', null)).toBe(false)
  })
})

describe('getVisibleUsageProvider', () => {
  it('keeps configured managed-account providers visible while snapshots are pending', () => {
    const visible = getVisibleUsageProvider(
      'codex',
      null,
      usageSettings({ codexManagedAccounts: [CODEX_ACCOUNT] })
    )

    expect(visible).toMatchObject({
      provider: 'codex',
      status: 'fetching',
      session: null,
      weekly: null
    })
  })

  it('keeps configured providers visible when a fetch returns unavailable', () => {
    const unavailable = provider('unavailable', {
      provider: 'claude',
      error: 'Claude OAuth access token unavailable'
    })

    expect(
      getVisibleUsageProvider(
        'claude',
        unavailable,
        usageSettings({ claudeManagedAccounts: [CLAUDE_ACCOUNT] })
      )
    ).toBe(unavailable)
  })

  it('hides providers with no live data or durable configuration', () => {
    expect(getVisibleUsageProvider('codex', null, usageSettings())).toBe(null)
    expect(getVisibleUsageProvider('claude', undefined, usageSettings())).toBe(null)
    expect(getVisibleUsageProvider('claude', provider('fetching'), usageSettings())).toBe(null)
  })

  it('creates a pending snapshot when an older main process omits a configured provider', () => {
    expect(
      getVisibleUsageProvider(
        'claude',
        undefined,
        usageSettings({ claudeManagedAccounts: [CLAUDE_ACCOUNT] })
      )
    ).toMatchObject({ provider: 'claude', status: 'fetching' })
  })
})

describe('isUsageEmptyState', () => {
  it('waits for provider snapshots before showing the setup CTA', () => {
    expect(isUsageEmptyState({ claude: null, codex: null }, usageSettings())).toBe(false)
  })

  it('treats provider keys omitted by an older main process as pending', () => {
    expect(
      isUsageEmptyState(
        { claude: provider('unavailable'), codex: undefined },
        usageSettings()
      )
    ).toBe(false)
  })

  it('does not show the setup CTA while system-default usage snapshots are fetching', () => {
    expect(
      isUsageEmptyState(
        { claude: provider('fetching'), codex: provider('unavailable', { provider: 'codex' }) },
        usageSettings()
      )
    ).toBe(false)
  })

  it('does not show the setup CTA when persisted accounts exist but snapshots have no usage data', () => {
    expect(
      isUsageEmptyState(
        {
          claude: provider('unavailable'),
          codex: provider('unavailable', { provider: 'codex' })
        },
        usageSettings({ codexManagedAccounts: [CODEX_ACCOUNT] })
      )
    ).toBe(false)
  })

  it('waits for settings before showing the setup CTA', () => {
    expect(
      isUsageEmptyState(
        {
          claude: provider('unavailable'),
          codex: provider('unavailable', { provider: 'codex' })
        },
        null
      )
    ).toBe(false)
  })

  it('shows the setup CTA for a loaded profile with no configured usage provider', () => {
    expect(
      isUsageEmptyState(
        {
          claude: provider('unavailable'),
          codex: provider('unavailable', { provider: 'codex' })
        },
        usageSettings()
      )
    ).toBe(true)
  })
})
