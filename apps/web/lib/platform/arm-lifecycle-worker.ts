import { dispatchArmWorkflow } from "../gen2/arm-workflow-bridge";

export { ArmWorkspaceLifecycleWorkflow } from "../runtime/arm-workspace-workflow";

/** Retained workflow service has no rendering, sockets, or public app routes. */
const worker = {
  async fetch(request: Request) {
    if (new URL(request.url).pathname !== "/api/gen2/compute/workflow")
      return new Response("Not Found", { status: 404 });
    try {
      return Response.json(await dispatchArmWorkflow(request));
    } catch (error) {
      const status =
        error instanceof Error && "status" in error
          ? Number(error.status)
          : 503;
      return Response.json(
        { error: "Workflow service unavailable." },
        { status },
      );
    }
  },
};

export default worker;
