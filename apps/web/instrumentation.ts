export async function register() {
  if (
    process.env.NEXT_RUNTIME !== "edge" &&
    process.env.WORKFLOW_TARGET_WORLD === "@workflow/world-postgres"
  ) {
    const { getWorld } = await import("workflow/runtime");
    await getWorld().start?.();
  }
}
