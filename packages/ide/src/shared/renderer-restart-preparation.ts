import {
  ORCA_EDITOR_PREPARE_HOT_EXIT_EVENT,
  type EditorPrepareHotExitDetail
} from './editor-save-events'

export type AppRestartPrepOptions = {
  startedEventName: string
  abortedEventName: string
  /** Joins the durable write of the state the checkpoint staged; rejects if it failed. */
  awaitCheckpoint: () => Promise<void>
}

function requestEditorHotExitBackup(eventTarget: EventTarget): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let claimed = false
    eventTarget.dispatchEvent(
      new CustomEvent<EditorPrepareHotExitDetail>(ORCA_EDITOR_PREPARE_HOT_EXIT_EVENT, {
        detail: {
          claim: () => {
            claimed = true
          },
          resolve,
          reject: (message) => {
            reject(new Error(message))
          }
        }
      })
    )

    // Why: restart paths can run before the editor autosave controller mounts.
    // With no claimant, there are no renderer-owned dirty buffers to back up.
    if (!claimed) {
      resolve()
    }
  })
}

export async function prepareRendererForAppRestart(
  eventTarget: EventTarget,
  { startedEventName, abortedEventName, awaitCheckpoint }: AppRestartPrepOptions
): Promise<void> {
  eventTarget.dispatchEvent(new Event(startedEventName))

  try {
    await requestEditorHotExitBackup(eventTarget)
    // Why: update installs can bypass native close. A cancelable synthetic
    // unload both captures mounted terminals and reports checkpoint failure.
    const accepted = eventTarget.dispatchEvent(new Event('beforeunload', { cancelable: true }))
    if (!accepted) {
      throw new Error('Renderer shutdown checkpoint was not completed.')
    }
    // Why: the checkpoint only stages synchronously. Navigating before that
    // write lands loses the session snapshot to a crash or power loss.
    await awaitCheckpoint()
  } catch (error) {
    eventTarget.dispatchEvent(new Event(abortedEventName))
    throw error
  }
}
