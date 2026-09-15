import type { SidebarHostOption } from './sidebar-host-options'

export function canSelectAddRepoHost(host: Pick<SidebarHostOption, 'health' | 'kind'>): boolean {
  return host.health === 'local' || host.health === 'available'
}

export function canConnectAddRepoHost(_host: Pick<SidebarHostOption, 'health' | 'kind'>): boolean {
  return false
}
