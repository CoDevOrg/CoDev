export type SmartWorkspaceCommandRowKind = 'use-name' | 'create-branch' | 'github' | 'branch'

export type SmartWorkspaceCommandRow = {
  kind: SmartWorkspaceCommandRowKind
  value: string
}

export type SmartWorkspaceSourceIntent = 'github' | null

export function resolveSmartWorkspaceCommandValue({
  currentValue,
  rows,
  isQueryStale,
  sourceIntent
}: {
  currentValue: string
  rows: readonly SmartWorkspaceCommandRow[]
  isQueryStale: boolean
  sourceIntent: SmartWorkspaceSourceIntent
}): string {
  if (rows.length === 0) {
    return currentValue
  }

  // Why: freeze the arm while the live input is ahead of debounced search so the
  // highlight does not thrash to use-name / empty / first-row on every keystroke.
  if (isQueryStale) {
    if (rows.some((row) => row.value === currentValue)) {
      return currentValue
    }
    const typedTextRow = rows.find((row) => row.kind === 'use-name' || row.kind === 'create-branch')
    return typedTextRow?.value ?? rows[0]?.value ?? ''
  }

  if (sourceIntent === 'github') {
    const githubRow = rows.find((row) => row.kind === 'github')
    if (githubRow) {
      return githubRow.value
    }
  }

  return rows.some((row) => row.value === currentValue) ? currentValue : rows[0].value
}
