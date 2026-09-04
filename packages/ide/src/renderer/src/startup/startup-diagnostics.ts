type StartupDiagnosticDetails = Record<string, unknown>

/** Carries the name of the step that threw, so a catch far from the failure can
 *  name it. Without this the only record is a diagnostic event the embedded web
 *  client cannot deliver, which is how a startup fault reaches a user as
 *  "Session restore failed" with no way to find out what failed. */
const STARTUP_STEP_KEY = '__rendererStartupStep__'

function annotateStartupStep(error: unknown, event: string): void {
  if (!(error instanceof Error) || STARTUP_STEP_KEY in error) {
    return
  }
  Object.defineProperty(error, STARTUP_STEP_KEY, {
    value: event,
    enumerable: false,
    writable: true
  })
}

export function readStartupStepFromError(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null
  }
  const step = (error as unknown as Record<string, unknown>)[STARTUP_STEP_KEY]
  return typeof step === 'string' ? step : null
}

function nowMs(): number {
  return Math.round(performance.now())
}

export function logRendererStartupDiagnostic(
  event: string,
  details: StartupDiagnosticDetails = {}
): void {
  const api = window.api?.app
  if (!api?.startupDiagnostic) {
    return
  }
  void api
    .startupDiagnostic(`renderer-${event}`, {
      rendererT: nowMs(),
      ...details
    })
    .catch(() => {
      // Diagnostics are best-effort and must never perturb startup behavior.
    })
}

export async function timeRendererStartupStep<T>(
  event: string,
  operation: () => Promise<T>,
  details: StartupDiagnosticDetails = {}
): Promise<T> {
  const startedAt = performance.now()
  try {
    const result = await operation()
    logRendererStartupDiagnostic(`${event}-done`, {
      durationMs: Math.round(performance.now() - startedAt),
      ...details
    })
    return result
  } catch (error) {
    logRendererStartupDiagnostic(`${event}-failed`, {
      durationMs: Math.round(performance.now() - startedAt),
      message: error instanceof Error ? error.message : String(error),
      ...details
    })
    annotateStartupStep(error, event)
    throw error
  }
}

export function timeRendererStartupSyncStep<T>(
  event: string,
  operation: () => T,
  details: StartupDiagnosticDetails = {}
): T {
  const startedAt = performance.now()
  try {
    const result = operation()
    logRendererStartupDiagnostic(`${event}-done`, {
      durationMs: Math.round(performance.now() - startedAt),
      ...details
    })
    return result
  } catch (error) {
    logRendererStartupDiagnostic(`${event}-failed`, {
      durationMs: Math.round(performance.now() - startedAt),
      message: error instanceof Error ? error.message : String(error),
      ...details
    })
    annotateStartupStep(error, event)
    throw error
  }
}
