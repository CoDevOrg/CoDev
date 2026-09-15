import { defineMethod, type RpcMethod } from '../core'

export const STATUS_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'status.get',
    params: null,
    handler: (_params, { runtime }) => ({
      ...runtime.getStatus(),
      // Why: set in main before the RPC server starts; forked hosts read the same variable.
      appVersion: process.env.ORCA_APP_VERSION ?? '0.0.0-dev'
    })
  })
]
