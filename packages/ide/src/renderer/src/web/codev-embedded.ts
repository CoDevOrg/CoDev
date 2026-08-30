/**
 * True when the Orca web client is running inside a CoDev workspace shell
 * (the parent opened it with the `codev=1` pairing-fragment contract; see
 * `codev-bootstrap.ts` / `web/main.tsx`). CoDev-only UI branches gate on this
 * so stock Orca behavior is untouched.
 *
 * Checks the `window.__CODEV_EMBEDDED__` flag `web/main.tsx` sets, and falls
 * back to reading the `codev=1` fragment directly so callers that run before
 * that assignment (e.g. `getStoredSettings()` during preload-API install)
 * still resolve correctly.
 */
export function isCodevEmbedded(
  win?: {
    __CODEV_EMBEDDED__?: boolean
    location?: { hash?: string }
  }
): boolean {
  // Callable from anywhere, including node test environments and any
  // server-side render: no window means not embedded, never a throw.
  const target = win ?? (typeof window === 'undefined' ? undefined : window)
  if (!target) return false
  if (target.__CODEV_EMBEDDED__) {
    return true
  }
  const hash = target.location?.hash
  if (!hash) {
    return false
  }
  try {
    return new URLSearchParams(hash.replace(/^#/, '')).get('codev') === '1'
  } catch {
    return false
  }
}
