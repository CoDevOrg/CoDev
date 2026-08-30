import { useEffect, useState, type JSX } from 'react'
import { SettingsSubsectionHeader } from './SettingsFormControls'
import {
  getCodevBridgeSnapshot,
  requestCodevBridge,
  subscribeCodevBridge,
  type CodevBridgeSnapshot
} from '@/web/codev-bridge'

export type CodevProfileSnapshot = {
  name: string | null
  email: string | null
  google: { connected: boolean }
  github: { connected: boolean; login: string | null }
  githubConnectUrl: string | null
}

export function CodevProfileView({
  connected,
  profile
}: {
  connected: boolean
  profile: CodevProfileSnapshot | null
}): JSX.Element {
  return (
    <div id="codev-profile" className="scroll-mt-6 space-y-3" data-codev-profile="true">
      <SettingsSubsectionHeader
        title="Profile"
        description="The identity and contact details connected to your CoDev account."
      />
      {!connected ? (
        <p className="text-xs text-muted-foreground">Connect the CoDev bridge to load your profile.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 rounded-md border border-border p-3 text-xs">
            <div>
              <p className="text-muted-foreground">Display name</p>
              <p className="font-medium">{profile?.name || 'Not set'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Email</p>
              <p className="font-medium">{profile?.email || 'Not set'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Security</p>
              <p className="font-medium">Managed by your sign-in provider</p>
            </div>
          </div>
          <ul className="space-y-2" aria-label="Connected accounts">
            <li
              className="flex items-center justify-between gap-2 rounded-md border border-border p-3 text-xs"
              data-codev-account-status={profile?.google.connected ? 'connected' : 'not_connected'}
            >
              <span className="font-medium">Google</span>
              <span className="text-muted-foreground">
                {profile?.google.connected ? 'Connected' : 'Not connected'}
              </span>
            </li>
            <li
              className="flex items-center justify-between gap-2 rounded-md border border-border p-3 text-xs"
              data-codev-account-status={profile?.github.connected ? 'connected' : 'not_connected'}
            >
              <span className="font-medium">GitHub</span>
              {profile?.github.connected ? (
                <span className="text-muted-foreground">
                  {profile.github.login ? `@${profile.github.login}` : 'Connected'}
                </span>
              ) : profile?.githubConnectUrl ? (
                <a
                  className="text-xs font-medium underline underline-offset-2"
                  href={profile.githubConnectUrl}
                  target="_top"
                  rel="noreferrer"
                >
                  Connect GitHub account
                </a>
              ) : (
                <span className="text-muted-foreground">Not connected</span>
              )}
            </li>
          </ul>
        </>
      )}
    </div>
  )
}

export function CodevProfileSection(): JSX.Element | null {
  const embedded = typeof window !== 'undefined' && Boolean(window.__CODEV_EMBEDDED__)
  const [bridge, setBridge] = useState<CodevBridgeSnapshot>(() => getCodevBridgeSnapshot())
  const [profile, setProfile] = useState<CodevProfileSnapshot | null>(null)

  useEffect(() => subscribeCodevBridge(() => setBridge(getCodevBridgeSnapshot())), [])

  useEffect(() => {
    if (!embedded || bridge.status !== 'connected') return
    let cancelled = false
    void requestCodevBridge<CodevProfileSnapshot>('profile.get')
      .then((result) => {
        if (!cancelled) setProfile(result)
      })
      .catch(() => {
        if (!cancelled) setProfile(null)
      })
    return () => {
      cancelled = true
    }
  }, [embedded, bridge.status])

  if (!embedded) return null

  return <CodevProfileView connected={bridge.status === 'connected'} profile={profile} />
}
