import "server-only";

/**
 * The realtime collaboration server, in layers: a Redis transport, the room
 * fan-out over its event stream, the Yjs snapshot store, conflict reporting
 * and resolution, and the socket session that drives them. Callers keep this
 * one import path.
 */

export {
  type CollaborationConflict,
  CollaborationConflictResolutionError,
  listCollaborationConflicts,
  reportCollaborationConflict,
  resolveCollaborationConflict,
} from "./collaboration-conflicts";
export {
  classifyFilesystemReconciliation,
  collaborativeConflictRevision,
} from "./collaboration-documents";
export {
  listWorkspacePresence,
  listWorkspacePresenceEntries,
  recordOrcaActiveFile,
  recordOrcaCursor,
} from "./collaboration-presence";
export { checkRealtimeConnection } from "./collaboration-redis";
export {
  collaborationSocketMaxPayload,
  handleCollaborationSocket,
} from "./collaboration-socket";
