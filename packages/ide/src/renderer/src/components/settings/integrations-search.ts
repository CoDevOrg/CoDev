import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

export const getIntegrationsPaneSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate(
      'auto.components.settings.integrations.search.f16e41cc72',
      'GitHub Integration'
    ),
    description: translate(
      'auto.components.settings.integrations.search.7166b9090c',
      'GitHub authentication via the gh CLI.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.integrations.search.b79c21bd42',
        'github'
      ),
      ...translateSearchKeyword('auto.components.settings.integrations.search.41ccade05c', 'gh'),
      ...translateSearchKeyword(
        'auto.components.settings.integrations.search.c450244ad7',
        'integration'
      )
    ]
  }
])
