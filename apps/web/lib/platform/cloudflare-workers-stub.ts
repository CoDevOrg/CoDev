export const env = {};

export class WorkflowEntrypoint<Environment = unknown, Parameters = unknown> {
  protected env: Environment;

  constructor(_context: unknown, environment: Environment) {
    this.env = environment;
  }
}
