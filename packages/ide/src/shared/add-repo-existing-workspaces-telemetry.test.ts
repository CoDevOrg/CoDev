import { describe, expect, it } from 'vitest'
import { eventSchemas } from './telemetry-events'

describe('add_repo_existing_workspaces_detected schema', () => {
  it('accepts count-only workspace migration context', () => {
    const parsed = eventSchemas.add_repo_existing_workspaces_detected.safeParse({
      source: 'local_folder_picker',
      existing_workspace_count: 3,
      existing_linked_workspace_count: 2,
      main_workspace_count: 1,
      branch_named_workspace_count: 2,
      detached_workspace_count: 1,
      custom_named_workspace_count: 1,
      sparse_workspace_count: 0,
      nth_repo_added: 1
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects raw workspace names via .strict()', () => {
    const parsed = eventSchemas.add_repo_existing_workspaces_detected.safeParse({
      source: 'local_folder_picker',
      existing_workspace_count: 1,
      existing_linked_workspace_count: 0,
      main_workspace_count: 1,
      branch_named_workspace_count: 1,
      detached_workspace_count: 0,
      custom_named_workspace_count: 0,
      sparse_workspace_count: 0,
      nth_repo_added: 1,
      workspace_names: ['secret-customer-branch']
    })
    expect(parsed.success).toBe(false)
  })

})
