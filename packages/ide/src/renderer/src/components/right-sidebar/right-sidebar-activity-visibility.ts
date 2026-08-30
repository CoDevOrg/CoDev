import type { ActivityBarItem } from './activity-bar-buttons'

type RightSidebarActivityVisibilityState = {
  isFolder: boolean
  isFolderWorkspace: boolean
  isSshRepo: boolean
  keepGitTabs?: boolean
}

export function getVisibleRightSidebarActivityItems(
  items: ActivityBarItem[],
  { isFolder, isFolderWorkspace, isSshRepo, keepGitTabs = false }: RightSidebarActivityVisibilityState
): ActivityBarItem[] {
  return items.filter((item) => {
    if (item.gitOnly && isFolder && !keepGitTabs) {
      return false
    }
    if (item.folderOnly && !isFolderWorkspace) {
      return false
    }
    if (item.sshOnly && !isSshRepo) {
      return false
    }
    return true
  })
}
