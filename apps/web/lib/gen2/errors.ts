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

/**
 * A save that lost a race. The guest compares `expectedRevision` against what
 * is on disk and rejects a mismatch, which is how a member's editor and the
 * agent stay off each other's toes on the one shared filesystem. The current
 * revision travels with the error so the UI can offer "overwrite" without a
 * second round trip.
 */
export class Gen2FileConflictError extends Error {
  readonly status = 409;

  constructor(
    readonly path: string,
    readonly currentRevision: string,
  ) {
    super("This file changed on the machine since you opened it.");
    this.name = "Gen2FileConflictError";
  }

  toResponse() {
    return Response.json(
      {
        error: this.message,
        code: "revision_mismatch",
        path: this.path,
        currentRevision: this.currentRevision,
      },
      { status: this.status },
    );
  }
}
