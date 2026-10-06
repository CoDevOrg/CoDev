export class OrchestratorError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly conflictPaths: string[] = [],
    readonly currentRevision?: string,
  ) {
    super(message);
    this.name = "OrchestratorError";
  }

  /** Used by `withUser` in place of the plain error body. */
  toResponse() {
    return Response.json(
      {
        error: this.message,
        conflictPaths: this.conflictPaths,
        ...(this.currentRevision
          ? { currentRevision: this.currentRevision }
          : {}),
      },
      { status: this.status },
    );
  }
}
