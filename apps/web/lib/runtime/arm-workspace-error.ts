export class ArmWorkspaceRuntimeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ArmWorkspaceRuntimeError";
  }
}
