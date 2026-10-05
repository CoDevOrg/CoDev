import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { ArmWorkspaceRuntimeError } from "./arm-workspace-error";
import type { WorkflowStep } from "cloudflare:workers";

type Context = {
  step: WorkflowStep;
  prefix: string;
  sequence: { value: number };
  insideStep: boolean;
  checkpoints: Record<string, unknown>;
  requests: { value: number };
};
const context = new AsyncLocalStorage<Context>();

/** Checkpoint bounded I/O, rather than an entire polling lifecycle. */
export class ArmWorkflowIO {
  static run<T>(
    step: WorkflowStep,
    prefix: string,
    checkpoints: Record<string, unknown>,
    action: () => Promise<T>,
  ) {
    return context.run(
      {
        step,
        prefix,
        sequence: { value: 0 },
        insideStep: false,
        checkpoints: { ...checkpoints },
        requests: { value: 0 },
      },
      action,
    );
  }

  static async checkpoint<T>(
    label: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const current = context.getStore();
    if (!current || current.insideStep) return action();
    const name = `${current.prefix}-${++current.sequence.value}-${label}`;
    if (Object.hasOwn(current.checkpoints, name))
      return current.checkpoints[name] as T;
    if (
      [
        "azure",
        "health",
        "guest",
        "progress",
        "repository-tree",
        "repository-file",
      ].includes(label) &&
      (current.requests.value += label.startsWith("repository-") ? 5 : 1) > 10
    )
      throw new ArmWorkspaceRuntimeError("WORKFLOW_CONTINUE");
    const result = await current.step.do(
      name,
      {
        timeout: "2 minutes",
        retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
      },
      () =>
        context.run({ ...current, insideStep: true }, async () => {
          const value = await action();
          // Workflow outputs must be serializable, including void callbacks.
          return value === undefined ? null : JSON.parse(JSON.stringify(value));
        }),
    );
    current.checkpoints[name] = result;
    return result as T;
  }

  static reset() {
    const current = context.getStore();
    if (current) {
      current.sequence.value = 0;
      current.checkpoints = {};
    }
  }

  static saved() {
    return context.getStore()?.checkpoints ?? {};
  }

  static async request<T>(
    label: string,
    action: () => Promise<{ response: Response; payload: T }>,
  ) {
    const result = await this.checkpoint(label, async () => {
      const { response, payload } = await action();
      return {
        status: response.status,
        headers: [...response.headers],
        payload,
      };
    });
    return {
      response: new Response(null, {
        status: result.status,
        headers: result.headers,
      }),
      payload: result.payload,
    };
  }

  static async sleep(milliseconds: number) {
    const current = context.getStore();
    if (!current || current.insideStep) {
      await new Promise((resolve) => setTimeout(resolve, milliseconds));
      return;
    }
    const name = `${current.prefix}-${++current.sequence.value}-wait`;
    if (Object.hasOwn(current.checkpoints, name)) return;
    await current.step.sleep(name, milliseconds);
    current.checkpoints[name] = null;
  }

  static async deadline(milliseconds: number) {
    return (
      (await this.checkpoint("clock", async () => Date.now())) + milliseconds
    );
  }
}
