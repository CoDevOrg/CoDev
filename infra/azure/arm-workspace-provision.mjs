import { lifecycleState as transition } from "./arm-workspace-state.mjs";

async function prepareCompute(service, workspaceId, current, move, ensure) {
  if (current().status === "queued") {
    await ensure();
    const state = current();
    const disk = state.dataDiskId
      ? await service.azure.requireDisk(state.dataDiskId, workspaceId)
      : await service.azure.createDisk(workspaceId);
    await move("provisioning", { dataDiskId: disk.id });
  }
  if (current().status === "provisioning") {
    await ensure();
    const state = current();
    if (state.lastVmGeneration)
      await service.azure.requireGenerationDeleted(
        workspaceId,
        state.lastVmGeneration,
      );
    await service.azure.requireUnattachedDisk(state.dataDiskId, workspaceId);
    const vm = await service.azure.createVm(
      workspaceId,
      state.generation,
      state.dataDiskId,
    );
    await move("booting", { vmId: vm.id, lastVmGeneration: state.generation });
  }
  if (current().status === "booting") {
    await ensure();
    await service.azure.waitRunning(current().vmId);
    await move("attaching_disk");
  }
}

async function prepareConnection(service, workspaceId, current, move, ensure) {
  if (current().status === "attaching_disk") {
    await ensure();
    const state = current();
    const uuid = await service.guest.prepare(state.vmId, state.diskUuid);
    await move("starting_tunnel", { diskUuid: uuid });
  }
  if (current().status === "starting_tunnel") {
    await ensure();
    const state = current();
    const route = await service.tunnel.ensure(
      workspaceId,
      state.generation,
      state.vmId,
      state.diskUuid,
    );
    await move("checking_readiness", {
      tunnelId: route.id,
      routeHost: route.host,
    });
  }
  if (current().status === "checking_readiness") {
    await ensure();
    const state = current();
    const health = await service.tunnel.health(
      state.routeHost,
      workspaceId,
      state.generation,
      state.diskUuid,
    );
    if (!health.ready)
      throw Object.assign(new Error("READINESS_TIMEOUT"), {
        code: "READINESS_TIMEOUT",
      });
    await move("ready", {
      lastMemberInputAt: service.clock(),
      agentRunning: false,
      failureAttempts: 0,
      errorTerminal: false,
      retryAt: null,
    });
  }
}

export async function provisionArmWorkspace(
  service,
  workspaceId,
  state,
  write,
  ensure,
) {
  const current = () => state;
  const move = async (status, changes = {}) => {
    state = await write(
      transition.advance(
        state,
        state.operation.id,
        state.generation,
        { status, ...changes },
        service.clock(),
      ),
    );
  };
  await prepareCompute(service, workspaceId, current, move, ensure);
  await prepareConnection(service, workspaceId, current, move, ensure);
  return state;
}
