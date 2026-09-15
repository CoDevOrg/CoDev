import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('startup ordering', () => {
  it('passes the startup barrier into PTY handlers without blocking window creation', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const attachStart = source.indexOf('attachMainWindowServices(')
    const attachEnd = source.indexOf('rateLimits.attach(window)', attachStart)
    const attachBlock = source.slice(attachStart, attachEnd)
    // Why: anchor on the destructure head only — the settled-result variable's name is not the
    // contract, and pinning it turns a rename into a cryptic `expected -1` failure here.
    const desktopStart = source.indexOf('const [win')
    // Why: anchor on code, not a comment — the previous comment anchor was silently reworded, so
    // this was -1 and sliced to EOF, letting the assertions below pass against never-run code.
    const desktopEnd = source.indexOf("win.once('show'", desktopStart)
    const desktopStartup = source.slice(desktopStart, desktopEnd)

    // Why: bound every anchor, not just the desktop pair — an unresolved one slices to EOF.
    expect(attachStart).toBeGreaterThanOrEqual(0)
    expect(attachEnd).toBeGreaterThan(attachStart)
    expect(desktopStart).toBeGreaterThanOrEqual(0)
    expect(desktopEnd).toBeGreaterThan(desktopStart)

    expect(attachBlock).toContain('awaitLocalPtyStartup: () => localPtyStartupReady')
    expect(attachBlock).toContain(
      'awaitLocalPtyProviderStartup: () => localPtyProviderStartupReady'
    )
    expect(source).toContain('firstWindowStartupServicesReady = startupServices.firstWindowReady')
    expect(source).toContain('localPtyStartupReady = startupServices.localPtyReady')

    const windowIndex = desktopStartup.indexOf('Promise.resolve(openMainWindow())')
    const rpcStartIndex = desktopStartup.indexOf('desktopRuntimeRpc.start()')
    const legacyRpcStartIndex = desktopStartup.indexOf('runtimeRpc.start()')

    expect(windowIndex).toBeGreaterThanOrEqual(0)
    expect(Math.max(rpcStartIndex, legacyRpcStartIndex)).toBeGreaterThanOrEqual(0)
    expect(desktopStartup).toContain('recordRuntimeRpcStartFailure(')
    // Why: `void`, not `await` — awaiting the dialog would park the rest of startup behind a modal.
    expect(desktopStartup).toMatch(/void showRuntimeRpcStartupFailureDialog\(\s*win,/)
    // Why (#11025): a bare console.error here is exactly what left the CLI dead but the app healthy.
    expect(desktopStartup).not.toContain(
      "console.error('[runtime] Failed to start local RPC transport:'"
    )
  })

  it('requires daemon authority before restored-subagent liveness runs', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const sweepStart = source.indexOf('function reapRestoredSubagentsWithoutLiveAgent()')
    const sweepEnd = source.indexOf('function startTerminalRuntimeStartupServices()', sweepStart)
    const sweep = source.slice(sweepStart, sweepEnd)

    expect(sweepStart).toBeGreaterThanOrEqual(0)
    expect(sweepEnd).toBeGreaterThan(sweepStart)
    expect(sweep).toContain('const provider = getDaemonProvider()')
    expect(sweep).toContain('if (!provider) {')
    expect(sweep).toContain('provider.probePtyLiveness(ptyId)')
  })

  it('reconciles retained Codex homes after authoritative daemon inventory', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const daemonInitIndex = source.indexOf('await initDaemonPtyProvider(signal')
    const routeGateIndex = source.indexOf(
      'codexRuntimeHome?.isHostSystemDefaultRealHome()',
      daemonInitIndex
    )
    const inventoryIndex = source.indexOf('await listLiveDaemonPtyIds()', daemonInitIndex)
    const reconciliation = 'codexRuntimeHome?.reconcileLegacySharedHomeForRetainedPanes()'
    const reconciliationIndex = source.indexOf(reconciliation, inventoryIndex)
    const serveIndex = source.indexOf('if (serveOptions) {', reconciliationIndex)
    const desktopIndex = source.indexOf('Promise.resolve(openMainWindow())', serveIndex)

    expect(daemonInitIndex).toBeGreaterThanOrEqual(0)
    expect(routeGateIndex).toBeGreaterThan(daemonInitIndex)
    expect(inventoryIndex).toBeGreaterThan(routeGateIndex)
    expect(reconciliationIndex).toBeGreaterThan(inventoryIndex)
    expect(serveIndex).toBeGreaterThan(reconciliationIndex)
    expect(desktopIndex).toBeGreaterThan(serveIndex)
    expect(source.split(reconciliation)).toHaveLength(2)
  })

  it('does not run the rate-limit quota fetch before the first window can show results', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const attachIndex = source.indexOf('rateLimits.attach(window)')
    const startIndex = source.indexOf('rateLimits.start({ fetchImmediately: false })')

    expect(attachIndex).toBeGreaterThanOrEqual(0)
    expect(startIndex).toBeGreaterThan(attachIndex)
  })

  it('keeps the power bridge through vetoable before-quit and disposes after commit', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const beforeQuitStart = source.indexOf("app.on('before-quit'")
    const willQuitStart = source.indexOf("app.on('will-quit'", beforeQuitStart)
    const windowAllClosedStart = source.indexOf("app.on('window-all-closed'", willQuitStart)
    const beforeQuit = source.slice(beforeQuitStart, willQuitStart)
    const willQuit = source.slice(willQuitStart, windowAllClosedStart)
    const commitIndex = willQuit.indexOf('quitTeardownStartGate.tryStart(e)')
    const disposeIndex = willQuit.indexOf('unsubscribeSystemResumeBroadcast?.()')

    expect(beforeQuitStart).toBeGreaterThanOrEqual(0)
    expect(willQuitStart).toBeGreaterThan(beforeQuitStart)
    expect(windowAllClosedStart).toBeGreaterThan(willQuitStart)
    expect(beforeQuit).not.toContain('unsubscribeSystemResumeBroadcast')
    expect(commitIndex).toBeGreaterThanOrEqual(0)
    expect(disposeIndex).toBeGreaterThan(commitIndex)
  })

  it('starts the automation scheduler before headless serve reports ready', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const serveStart = source.indexOf('if (serveOptions) {')
    const serveReady = source.indexOf('await printServeReady(serveOptions)', serveStart)
    const serveReturn = source.indexOf('return', serveReady)
    const runtimeRpcStart = source.indexOf('await runtimeRpc.start()', serveStart)
    const automationStart = source.indexOf('automations.start()', serveStart)
    const desktopSetWebContents = source.indexOf('automations.setWebContents(window.webContents)')
    const desktopAutomationStart = source.indexOf('automations.start()', desktopSetWebContents + 1)

    expect(serveStart).toBeGreaterThanOrEqual(0)
    expect(serveReady).toBeGreaterThan(serveStart)
    expect(serveReturn).toBeGreaterThan(serveReady)
    expect(runtimeRpcStart).toBeGreaterThan(serveStart)
    expect(automationStart).toBeGreaterThan(runtimeRpcStart)
    expect(automationStart).toBeLessThan(serveReady)
    expect(automationStart).toBeLessThan(serveReturn)
    expect(desktopSetWebContents).toBeGreaterThanOrEqual(0)
    expect(desktopAutomationStart).toBeGreaterThan(desktopSetWebContents)
  })
})
