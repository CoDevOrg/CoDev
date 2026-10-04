import application from "vinext/server/fetch-handler";

const worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return application.fetch(request, env, ctx);
  },
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    const response = await application.fetch(
      new Request("https://internal/api/gen2/compute/reconcile", {
        headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
      }),
      env,
      ctx,
    );
    if (!response.ok) {
      throw new Error(`Compute reconciliation failed with ${response.status}`);
    }
    await response.text();
  },
} satisfies ExportedHandler<Env>;

export default worker;
