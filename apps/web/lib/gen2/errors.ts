export class Gen2AccessError extends Error {
  constructor(
    message = "Workspace not found.",
    readonly status = 404,
  ) {
    super(message);
    this.name = "Gen2AccessError";
  }
}

export class Gen2LifecycleError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "Gen2LifecycleError";
  }
}
