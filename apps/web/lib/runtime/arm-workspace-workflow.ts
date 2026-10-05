import { WorkflowEntrypoint, type WorkflowStep } from "cloudflare:workers";

import {
  runArmWorkspaceLifecycle,
  type ArmWorkspaceWorkflowParams,
} from "../gen2/runtime-operations";

export class ArmWorkspaceLifecycleWorkflow extends WorkflowEntrypoint<
  Env,
  ArmWorkspaceWorkflowParams
> {
  async run(
    event: { payload: Readonly<ArmWorkspaceWorkflowParams> },
    step: WorkflowStep,
  ) {
    await runArmWorkspaceLifecycle(this.env, event.payload, step);
  }
}
