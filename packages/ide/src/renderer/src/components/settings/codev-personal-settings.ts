/**
 * CoDev personal settings surface.
 *
 * CoDev embeds this same Orca client twice: once inside a workspace, and once
 * as the signed-in member's own settings page (opened outside any workspace,
 * paired to a personal no-repo runtime). In the personal surface only settings
 * that belong to the person are meaningful — anything scoped to a specific
 * workspace, repository, or host is hidden because there is no workspace in
 * context to apply it to.
 */

/** Section ids that belong to the person rather than a workspace. */
const PERSONAL_SECTION_IDS = new Set([
  'agents',
  'accounts',
  'orchestration',
  'linear',
  'computer-use',
  'voice',
  'general',
  'integrations',
  'mobile',
  'appearance',
  'input',
  'notifications',
  'shortcuts',
  'privacy',
  'advanced',
  'experimental',
  'plugins'
])

export function isCodevSettingsOnly(
  target: Pick<Window, 'self'> & { __CODEV_SETTINGS_ONLY__?: boolean } = window
): boolean {
  return target.__CODEV_SETTINGS_ONLY__ === true
}

export function isPersonalSettingsSection(sectionId: string): boolean {
  return PERSONAL_SECTION_IDS.has(sectionId)
}

/**
 * Drop workspace-scoped sections when rendering the personal surface, and add
 * back any CoDev-only personal sections (e.g. Profile) that have no upstream
 * nav entry at all. Per-repo panes (`repo-*`) are always workspace-scoped, so
 * they never survive here.
 */
export function filterPersonalSettingsSections<T extends { id: string }>(
  sections: readonly T[],
  settingsOnly: boolean,
  extraPersonalSections: readonly T[] = []
): T[] {
  if (!settingsOnly) return [...sections]
  return [
    ...extraPersonalSections,
    ...sections.filter((section) => isPersonalSettingsSection(section.id))
  ]
}
