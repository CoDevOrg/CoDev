// @vitest-environment happy-dom

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { GeneralUpdateSettingsSection } from './GeneralUpdateSettingsSection'

describe('GeneralUpdateSettingsSection', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, '__ORCA_WEB_CLIENT__')
  })

  it('replaces the native updater button with honest web update copy', () => {
    Object.assign(window, { __ORCA_WEB_CLIENT__: true })

    const markup = renderToStaticMarkup(<GeneralUpdateSettingsSection />)

    expect(markup).toContain('The web app updates automatically.')
    expect(markup).not.toContain('Check for Updates')
  })
})
