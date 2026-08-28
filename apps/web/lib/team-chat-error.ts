/**
 * Team chat failures carry their own HTTP status. Kept in its own module so a
 * route (or a test standing in for the data layer) can classify an error
 * without importing the server-only query layer.
 */
export class TeamChatError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "TeamChatError";
  }
}
