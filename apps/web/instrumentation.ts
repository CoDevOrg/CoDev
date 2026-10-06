export async function register() {
  if (
    process.env.NEXT_RUNTIME !== "edge" &&
    process.env.WORKFLOW_TARGET_WORLD === "@workflow/world-postgres"
  ) {
    const { getWorld } = await import("workflow/runtime");
    const world = getWorld();
    const start = () => {
      void world.start?.().catch(() => {
        console.error("Workflow queue startup failed; retrying in 30 seconds.");
        setTimeout(start, 30_000).unref();
      });
    };
    // Durable jobs can wait for their queue without taking HTTP serving down.
    start();
  }
}
