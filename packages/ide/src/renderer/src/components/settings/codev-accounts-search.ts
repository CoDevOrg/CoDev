import type { SettingsSearchEntry } from './settings-search'

export function getCodevAccountsSearchEntries(): SettingsSearchEntry[] {
  return [
    {
      title: 'AI Provider Accounts',
      description: 'Connect Claude, Codex, and Cursor for chat rooms and coding workspaces.',
      keywords: [
        'claude',
        'codex',
        'cursor',
        'openai',
        'anthropic',
        'api key',
        'chat rooms',
        'coding workspaces',
        'subscription',
        'connect',
        'sign in'
      ]
    }
  ]
}
