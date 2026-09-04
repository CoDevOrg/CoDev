import '../assets/main.css'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import ReactDOM from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import WebConnect from './WebConnect'
import { RecoverableRenderErrorBoundary } from '../components/error-boundaries/RecoverableRenderErrorBoundary'
import {
  clearPairingInputFromAddressBar,
  decideWebPairingStartup,
  parseWebPairingInput,
  readPairingInputFromLocation
} from './web-pairing'
import {
  createStoredWebRuntimeEnvironment,
  readStoredWebRuntimeEnvironment,
  saveStoredWebRuntimeEnvironment
} from './web-runtime-environment'
import { installWebPreloadApi } from './web-preload-api'
import { I18nProvider } from '../i18n/I18nProvider'
import { translate } from '../i18n/i18n'
import { readCodevBootstrap } from './codev-bootstrap'
import {
  parseCodevPairMessage,
  readCodevPendingEmbed,
  type CodevPairPayload
} from './codev-pair-message'
import { installCodevHostStateListener } from './codev-host-state'

const App = lazy(() => import('../App'))

function WebRoot(): React.JSX.Element {
  const codevBootstrap = useMemo(() => readCodevBootstrap(window.location), [])
  // CoDev opens this client the instant the workspace route mounts, before its
  // EC2 host is awake: the fragment then says `codev=1&codevPending=1` and the
  // real pairing + project path arrive later over a `codev:pair` message.
  const codevPending = useMemo(() => readCodevPendingEmbed(window.location), [])
  const [pairPayload, setPairPayload] = useState<CodevPairPayload | null>(null)
  const codevBoot = codevBootstrap ?? pairPayload?.bootstrap ?? null
  window.__CODEV_EMBEDDED__ = codevBootstrap !== null || codevPending
  // Installed before any lazy chunk loads, so a host report that arrives while
  // the awaiting-workspace cover is still downloading is not lost.
  if (window.__CODEV_EMBEDDED__) {
    installCodevHostStateListener()
  }
  window.__CODEV_PROJECT_PATH__ = codevBoot?.projectPath
  window.__CODEV_PROJECT_KIND__ = codevBoot?.projectKind
  window.__CODEV_PROJECT_NAME__ = codevBoot?.projectName
  window.__CODEV_DEFAULT_AGENT__ = codevBoot?.defaultAgent
  window.__CODEV_MEMBER_ID__ = codevBoot?.memberId
  window.__CODEV_SETTINGS_ONLY__ = codevBoot?.settingsOnly === true
  window.__CODEV_CURSOR_AVAILABLE__ = codevBoot?.cursorAvailable === true

  const initialPairingInput = useMemo(() => readPairingInputFromLocation(window.location), [])
  // Why: current runtime links carry scope metadata. Runtime-scope offers keep
  // the instant save path; mobile/legacy-unknown offers must be shown/probed.
  const startupDecision = useMemo(() => {
    const decision = decideWebPairingStartup({
      initialPairingInput,
      hasStoredEnvironment: readStoredWebRuntimeEnvironment() !== null
    })
    if (
      decision.kind === 'auto-save-runtime-offer' ||
      (decision.kind === 'show-connect' && decision.initialPairingInput !== null)
    ) {
      clearPairingInputFromAddressBar()
    }
    return decision
  }, [initialPairingInput])
  const [hasEnvironment, setHasEnvironment] = useState(() => {
    if (startupDecision.kind === 'auto-save-runtime-offer') {
      saveStoredWebRuntimeEnvironment(
        createStoredWebRuntimeEnvironment({
          name: 'Orca Server',
          offer: startupDecision.offer,
          previousEnvironment: readStoredWebRuntimeEnvironment()
        })
      )
      return true
    }
    return startupDecision.kind === 'use-stored-environment'
  })

  // While pending: tell the parent the shell has painted (so it can drop its
  // loading overlay) and listen for the late pairing. On receipt, persist the
  // runtime environment and flip `pairPayload`, which remounts `<App>` below.
  useEffect(() => {
    if (!codevPending || pairPayload) {
      return
    }
    function onMessage(event: MessageEvent): void {
      if (event.origin !== window.location.origin) {
        return
      }
      const payload = parseCodevPairMessage(event.data)
      if (!payload) {
        return
      }
      const offer = parseWebPairingInput(payload.pairing)
      if (!offer) {
        return
      }
      saveStoredWebRuntimeEnvironment(
        createStoredWebRuntimeEnvironment({
          name: 'CoDev workspace',
          offer,
          previousEnvironment: readStoredWebRuntimeEnvironment()
        })
      )
      setPairPayload(payload)
    }
    window.addEventListener('message', onMessage)
    // Announce the shell only after a paint, so a render that throws is caught
    // by the boundary first and the parent keeps its skeleton up.
    const raf = window.requestAnimationFrame(() => {
      window.parent.postMessage({ type: 'codev:shell-ready' }, window.location.origin)
    })
    return () => {
      window.cancelAnimationFrame(raf)
      window.removeEventListener('message', onMessage)
    }
  }, [codevPending, pairPayload])

  // Pending shell: mount `<App>` now with no runtime environment so the IDE
  // chrome paints immediately. The `codev:pair` handler above then saves the
  // environment and sets `pairPayload`, which drops through to the keyed
  // remount below (fresh `<App>` picks up the stored environment and connects).
  if (codevPending && !pairPayload) {
    installWebPreloadApi()
    return (
      <Suspense fallback={<div className="min-h-dvh bg-background" />}>
        <App />
      </Suspense>
    )
  }

  if (!hasEnvironment && !pairPayload) {
    return (
      <WebConnect
        initialPairingInput={
          startupDecision.kind === 'show-connect' ? startupDecision.initialPairingInput : null
        }
        onConnected={() => setHasEnvironment(true)}
      />
    )
  }

  installWebPreloadApi()
  return (
    <Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <App key={pairPayload ? 'codev-paired' : 'default'} />
    </Suspense>
  )
}

function WebRootBoundary(): React.JSX.Element {
  useTranslation()
  return (
    <RecoverableRenderErrorBoundary
      boundaryId="web.root"
      surface="web-root"
      title={translate('app.recoverableError.webTitle', 'Orca web hit a renderer error.')}
      description={translate(
        'app.recoverableError.webDescription',
        'Retry the web client or reconnect to the paired runtime.'
      )}
    >
      <WebRoot />
    </RecoverableRenderErrorBoundary>
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <I18nProvider>
    <WebRootBoundary />
  </I18nProvider>
)
