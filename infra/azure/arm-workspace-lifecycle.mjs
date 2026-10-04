import { lifecycleState as transition } from "./arm-workspace-state.mjs";
import { provisionArmWorkspace } from "./arm-workspace-provision.mjs";

// Infrastructure worker. The Blob lease is the durable single-writer fence;
// every side effect has a generation-scoped Azure/Cloudflare resource name.
export class ArmWorkspaceLifecycle {
  constructor(state, azure, tunnel, guest, clock = Date.now) {
    this.state = state;
    this.azure = azure;
    this.tunnel = tunnel;
    this.guest = guest;
    this.clock = clock;
  }

  async cleanupFailedGeneration(workspaceId, generation) {
    let routeError;
    try {
      await this.tunnel.revokeGeneration(workspaceId, generation);
    } catch (error) {
      routeError = error;
    }
    await this.azure.reconcileGeneration(workspaceId, generation);
    if (routeError) throw routeError;
  }

  async locked(workspaceId, action) {
    await this.state.initialize(workspaceId);
    const lease = await this.state.acquire(workspaceId);
    let lost = false;
    const timer = setInterval(() => {
      this.state.renew(workspaceId, lease).catch(() => {
        lost = true;
      });
    }, 20_000);
    try {
      const current = await this.state.read(workspaceId);
      const write = async (next) => {
        if (lost) throw new Error("LEASE_LOST");
        await this.state.renew(workspaceId, lease);
        current.etag = await this.state.write(
          workspaceId,
          lease,
          current.etag,
          next,
        );
        current.state = next;
        return next;
      };
      const ensure = async () => {
        if (lost) throw new Error("LEASE_LOST");
        await this.state.renew(workspaceId, lease);
      };
      return await action(current.state, write, ensure);
    } finally {
      clearInterval(timer);
      await this.state.release(workspaceId, lease).catch(() => {});
    }
  }

  async start(workspaceId, key) {
    return this.locked(workspaceId, async (state, write, ensure) => {
      if (state.status === "ready") return state;
      if (
        [
          "queued",
          "provisioning",
          "booting",
          "attaching_disk",
          "starting_tunnel",
          "checking_readiness",
        ].includes(state.status)
      ) {
        if (state.operation?.key !== key)
          throw new Error("WORKSPACE_OPERATION_CONFLICT");
      } else {
        const next = transition.beginStart(state, key, this.clock());
        if (state.status === "failed" && state.cleanupPending) {
          await ensure();
          await this.cleanupFailedGeneration(workspaceId, state.generation);
        }
        state = await write(next);
      }
      try {
        return await provisionArmWorkspace(
          this,
          workspaceId,
          state,
          write,
          ensure,
        );
      } catch (error) {
        if (
          error.message === "LEASE_LOST" ||
          error.message === "STALE_OPERATION"
        )
          throw error;
        state = (await this.state.read(workspaceId)).state;
        const result = transition.classifyAzureFailure(error.code);
        const failureAttempts = state.operation.attempts + 1;
        const retryAt = result.retryable
          ? transition.nextRetry(failureAttempts, this.clock())
          : null;
        await write({
          ...state,
          status: "failed",
          errorCode: result.safeCode,
          retryAt,
          failureAttempts,
          errorTerminal: !retryAt,
          cleanupPending: true,
          operation: { ...state.operation, attempts: failureAttempts },
        });
        try {
          await ensure();
          await this.cleanupFailedGeneration(workspaceId, state.generation);
          state = (await this.state.read(workspaceId)).state;
          await write({
            ...state,
            cleanupPending: false,
            vmId: null,
            tunnelId: null,
            routeHost: null,
          });
        } catch {
          /* Reconciler retries owned generation cleanup. */
        }
        throw error;
      }
    });
  }

  async stop(workspaceId, key) {
    return this.locked(workspaceId, async (state, write, ensure) => {
      if (state.status === "stopped") return state;
      if (key.startsWith("idle-")) {
        const running = await this.guest.hasRunningAgents(state.vmId);
        if (running) {
          return write({
            ...state,
            agentRunning: true,
            lastAgentActiveAt: this.clock(),
          });
        }
        state = await write({ ...state, agentRunning: false });
        if (!transition.shouldStopForIdle(state, this.clock())) return state;
      }
      const resourceGeneration =
        state.status === "stopping" ? state.generation - 1 : state.generation;
      if (state.status !== "stopping") {
        state = await write(transition.beginStop(state, key, this.clock()));
      } else if (state.operation?.key !== key) {
        throw new Error("WORKSPACE_OPERATION_CONFLICT");
      }
      try {
        await ensure();
        let routeError;
        try {
          await this.tunnel.revokeGeneration(workspaceId, resourceGeneration);
        } catch (error) {
          routeError = error;
        }
        if (state.vmId && state.flushRequired) {
          await this.guest.flush(state.vmId);
          state = await write({ ...state, flushRequired: false });
        }
        await ensure();
        await this.azure.cleanupGeneration(workspaceId, resourceGeneration);
        if (routeError) throw routeError;
        state = await write({
          ...state,
          status: "stopped",
          vmId: null,
          tunnelId: null,
          routeHost: null,
          operation: null,
          agentRunning: false,
          flushRequired: false,
        });
        return state;
      } catch (error) {
        await write({
          ...state,
          errorCode: "STOP_FAILED",
          retryAt: transition.nextRetry(state.operation.attempts, this.clock()),
          operation: {
            ...state.operation,
            attempts: state.operation.attempts + 1,
          },
        });
        throw error;
      }
    });
  }

  async idle(workspaceId) {
    const state = (await this.state.read(workspaceId)).state;
    const last = Math.max(
      state.lastMemberInputAt ?? 0,
      state.lastAgentActiveAt ?? 0,
    );
    if (state.status !== "ready" || this.clock() - last < 15 * 60_000)
      return state;
    return this.stop(workspaceId, `idle-${state.generation}`);
  }

  async memberInput(workspaceId) {
    return this.locked(workspaceId, async (state, write) =>
      write(transition.recordMemberInput(state, this.clock())),
    );
  }

  async reconcile(workspaceId) {
    const state = (await this.state.read(workspaceId)).state;
    if (state.status === "failed" && state.cleanupPending)
      return this.locked(workspaceId, async (current, write, ensure) => {
        if (current.status !== "failed" || !current.cleanupPending)
          return current;
        await ensure();
        await this.cleanupFailedGeneration(workspaceId, current.generation);
        return write({
          ...current,
          cleanupPending: false,
          vmId: null,
          tunnelId: null,
          routeHost: null,
        });
      });
    if (!state.operation || state.operation.leaseUntil > this.clock())
      return state;
    if (state.status === "stopping")
      return this.stop(workspaceId, state.operation.key);
    if (
      [
        "queued",
        "provisioning",
        "booting",
        "attaching_disk",
        "starting_tunnel",
        "checking_readiness",
      ].includes(state.status)
    )
      return this.start(workspaceId, state.operation.key);
    return state;
  }

  async delete(workspaceId, receipt) {
    if (receipt?.workspaceId !== workspaceId || !receipt.productDeletedAt)
      throw new Error("PRODUCT_DELETE_REQUIRED");
    await this.stop(workspaceId, `delete-${receipt.productDeletedAt}`);
    return this.locked(workspaceId, async (state, write, ensure) => {
      if (!state.dataDiskId) return state;
      await ensure();
      await this.azure.deleteOwnedDisk(state.dataDiskId, workspaceId);
      return write({
        ...state,
        dataDiskId: null,
        diskUuid: null,
        status: "stopped",
      });
    });
  }
}
