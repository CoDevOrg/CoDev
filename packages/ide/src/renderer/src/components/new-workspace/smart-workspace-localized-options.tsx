import type React from 'react'
import { CaseSensitive, GitBranch, Github, Sparkles } from 'lucide-react'

import { translate } from '@/i18n/i18n'
import type { SmartNameMode } from './smart-workspace-source-results'

export type SmartWorkspaceNameModeOption = {
  id: SmartNameMode
  label: string
  Icon: React.ComponentType<{ className?: string }>
}

export function getSmartWorkspaceNameModes(): SmartWorkspaceNameModeOption[] {
  return [
    {
      id: 'smart',
      label: translate('auto.components.new.workspace.SmartWorkspaceNameField.b3c60c2b7c', 'Smart'),
      Icon: Sparkles
    },
    {
      id: 'github',
      label: translate(
        'auto.components.new.workspace.SmartWorkspaceNameField.0a180280bd',
        'GitHub'
      ),
      Icon: Github
    },
    {
      id: 'branches',
      label: translate(
        'auto.components.new.workspace.SmartWorkspaceNameField.2e4c7c95fe',
        'Branch'
      ),
      Icon: GitBranch
    },
    {
      id: 'text',
      label: translate('auto.components.new.workspace.SmartWorkspaceNameField.6f07a18604', 'Name'),
      Icon: CaseSensitive
    }
  ]
}
