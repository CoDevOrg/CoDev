import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const workspaceStatus = pgEnum("workspace_status", [
  "pending",
  "provisioning",
  "ready",
  "stopping",
  "stopped",
  "failed",
]);
export const sandboxRuntimeStatus = pgEnum("sandbox_runtime_status", [
  "provisioning",
  "ready",
  "stopping",
  "stopped",
  "failed",
]);
export const memberRole = pgEnum("member_role", ["owner", "member"]);
export const worktreeKind = pgEnum("worktree_kind", ["integration", "agent"]);
export const worktreeStatus = pgEnum("worktree_status", [
  "active",
  "frozen",
  "merged",
  "discarded",
]);
export const agentSessionStatus = pgEnum("agent_session_status", [
  "idle",
  "running",
  "waiting",
  "completed",
  "interrupted",
  "failed",
]);
export const agentTurnStatus = pgEnum("agent_turn_status", [
  "queued",
  "running",
  "completed",
  "interrupted",
  "failed",
]);
export const claimStatus = pgEnum("claim_status", [
  "active",
  "released",
  "expired",
  "contested",
]);
export const messageStatus = pgEnum("coordination_message_status", [
  "pending",
  "delivered",
  "resolved",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    githubUserId: bigint("github_user_id", { mode: "bigint" }).notNull(),
    login: text("login").notNull(),
    name: text("name"),
    email: text("email"),
    avatarUrl: text("avatar_url"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("users_github_user_id_idx").on(table.githubUserId),
    uniqueIndex("users_login_idx").on(table.login),
  ],
);

export const githubConnections = pgTable(
  "github_connections",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    encryptedAccessToken: text("encrypted_access_token").notNull(),
    encryptedRefreshToken: text("encrypted_refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    tokenType: text("token_type").default("bearer").notNull(),
    scope: text("scope"),
    keyVersion: integer("key_version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    index("github_connections_access_expiry_idx").on(
      table.accessTokenExpiresAt,
    ),
  ],
);

export const providerCredentials = pgTable(
  "provider_credentials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    provider: text("provider").notNull(),
    encryptedValue: text("encrypted_value").notNull(),
    keyVersion: integer("key_version").default(1).notNull(),
    lastFour: text("last_four").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("provider_credentials_user_provider_idx").on(
      table.userId,
      table.provider,
    ),
  ],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    githubInstallationId: bigint("github_installation_id", {
      mode: "bigint",
    }).notNull(),
    githubRepositoryId: bigint("github_repository_id", {
      mode: "bigint",
    }).notNull(),
    repository: text("repository").notNull(),
    defaultBranch: text("default_branch").notNull(),
    baseSha: text("base_sha").notNull(),
    status: workspaceStatus("status").default("pending").notNull(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("workspaces_owner_idx").on(table.ownerId),
    index("workspaces_repository_idx").on(table.githubRepositoryId),
    index("workspaces_status_expiry_idx").on(table.status, table.expiresAt),
  ],
);

export const workspaceRuntimes = pgTable(
  "workspace_runtimes",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sandboxId: text("sandbox_id").unique(),
    backend: text("backend").default("firecracker").notNull(),
    status: sandboxRuntimeStatus("status").default("provisioning").notNull(),
    lastError: text("last_error"),
    provisionedAt: timestamp("provisioned_at", { withTimezone: true }),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("workspace_runtimes_status_updated_idx").on(
      table.status,
      table.updatedAt,
    ),
  ],
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    role: memberRole("role").default("member").notNull(),
    canTerminal: boolean("can_terminal").default(false).notNull(),
    canMerge: boolean("can_merge").default(false).notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index("workspace_members_user_idx").on(table.userId),
  ],
);

export const workspaceInvites = pgTable(
  "workspace_invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    createdBy: uuid("created_by")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: uuid("accepted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("workspace_invites_token_hash_idx").on(table.tokenHash),
    index("workspace_invites_workspace_idx").on(table.workspaceId),
  ],
);

export const worktrees = pgTable(
  "worktrees",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    kind: worktreeKind("kind").notNull(),
    name: text("name").notNull(),
    headSha: text("head_sha").notNull(),
    status: worktreeStatus("status").default("active").notNull(),
    reviewHeadSha: text("review_head_sha"),
    reviewBaseSha: text("review_base_sha"),
    reviewDiffDigest: text("review_diff_digest"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    discardedAt: timestamp("discarded_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("worktrees_workspace_name_idx").on(
      table.workspaceId,
      table.name,
    ),
    index("worktrees_workspace_status_idx").on(table.workspaceId, table.status),
  ],
);

export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    worktreeId: uuid("worktree_id")
      .references(() => worktrees.id, { onDelete: "cascade" })
      .notNull(),
    createdBy: uuid("created_by")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    issueNumber: integer("issue_number"),
    name: text("name").notNull().default("Agent"),
    model: text("model").notNull().default("gpt-5.6-sol"),
    status: agentSessionStatus("status").default("idle").notNull(),
    workflowRunId: text("workflow_run_id"),
    lastError: text("last_error"),
    interruptedAt: timestamp("interrupted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("agent_sessions_workspace_issue_idx").on(
      table.workspaceId,
      table.issueNumber,
    ),
    index("agent_sessions_workspace_status_idx").on(
      table.workspaceId,
      table.status,
    ),
  ],
);

export const agentTurns = pgTable(
  "agent_turns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .references(() => agentSessions.id, { onDelete: "cascade" })
      .notNull(),
    authorId: uuid("author_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    prompt: text("prompt").notNull(),
    status: agentTurnStatus("status").default("queued").notNull(),
    workflowRunId: text("workflow_run_id"),
    responseId: text("response_id"),
    output: text("output"),
    lastError: text("last_error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("agent_turns_session_created_idx").on(
      table.sessionId,
      table.createdAt,
    ),
  ],
);

export const agentEvents = pgTable(
  "agent_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    sessionId: uuid("session_id")
      .references(() => agentSessions.id, { onDelete: "cascade" })
      .notNull(),
    turnId: uuid("turn_id")
      .references(() => agentTurns.id, { onDelete: "cascade" })
      .notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("agent_events_idempotency_idx").on(table.idempotencyKey),
    index("agent_events_session_created_idx").on(
      table.sessionId,
      table.createdAt,
    ),
  ],
);

export const githubIssueAssignments = pgTable(
  "github_issue_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    sessionId: uuid("session_id")
      .references(() => agentSessions.id, { onDelete: "cascade" })
      .notNull(),
    githubRepositoryId: bigint("github_repository_id", {
      mode: "bigint",
    }).notNull(),
    issueNumber: integer("issue_number").notNull(),
    githubIssueId: bigint("github_issue_id", { mode: "bigint" }).notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("github_issue_assignments_repository_issue_idx").on(
      table.githubRepositoryId,
      table.issueNumber,
    ),
    uniqueIndex("github_issue_assignments_session_idx").on(table.sessionId),
    index("github_issue_assignments_workspace_idx").on(table.workspaceId),
  ],
);

export const workspaceEvents = pgTable(
  "workspace_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    type: text("type").notNull(),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("workspace_events_sequence_idx").on(
      table.workspaceId,
      table.sequence,
    ),
  ],
);

export const pathClaims = pgTable(
  "path_claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .references(() => agentSessions.id, { onDelete: "cascade" })
      .notNull(),
    pathGlob: text("path_glob").notNull(),
    intent: text("intent").notNull(),
    revision: text("revision").notNull(),
    status: claimStatus("status").default("active").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("path_claims_session_status_idx").on(table.sessionId, table.status),
    index("path_claims_expiry_idx").on(table.status, table.expiresAt),
  ],
);

export const coordinationMessages = pgTable(
  "coordination_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    fromSessionId: uuid("from_session_id")
      .references(() => agentSessions.id, { onDelete: "cascade" })
      .notNull(),
    toSessionId: uuid("to_session_id")
      .references(() => agentSessions.id, { onDelete: "cascade" })
      .notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    correlationId: uuid("correlation_id").defaultRandom().notNull(),
    responseToId: uuid("response_to_id"),
    status: messageStatus("status").default("pending").notNull(),
    ...timestamps,
  },
  (table) => [
    index("coordination_messages_target_status_idx").on(
      table.toSessionId,
      table.status,
    ),
  ],
);

export const yjsSnapshots = pgTable(
  "yjs_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    worktreeId: uuid("worktree_id")
      .references(() => worktrees.id, { onDelete: "cascade" })
      .notNull(),
    path: text("path").notNull(),
    revision: text("revision").notNull(),
    update: text("update_base64").notNull(),
    stateVector: text("state_vector_base64").default("").notNull(),
    filesystemContents: text("filesystem_contents").default("").notNull(),
    filesystemRevision: text("filesystem_revision"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    hasConflict: boolean("has_conflict").default(false).notNull(),
    conflictFilesystemRevision: text("conflict_filesystem_revision"),
    conflictDetectedAt: timestamp("conflict_detected_at", {
      withTimezone: true,
    }),
    conflictResolvedAt: timestamp("conflict_resolved_at", {
      withTimezone: true,
    }),
    conflictResolvedBy: uuid("conflict_resolved_by").references(
      () => users.id,
      {
        onDelete: "set null",
      },
    ),
    conflictResolution: text("conflict_resolution"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("yjs_snapshots_worktree_path_idx").on(
      table.worktreeId,
      table.path,
    ),
  ],
);

export const collaborationConflictResolutions = pgTable(
  "collaboration_conflict_resolutions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    worktreeId: uuid("worktree_id")
      .references(() => worktrees.id, { onDelete: "cascade" })
      .notNull(),
    path: text("path").notNull(),
    resolvedBy: uuid("resolved_by")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    strategy: text("strategy").notNull(),
    snapshotRevision: text("snapshot_revision").notNull(),
    filesystemRevision: text("filesystem_revision").notNull(),
    resultRevision: text("result_revision").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("collaboration_conflict_resolutions_document_idx").on(
      table.worktreeId,
      table.path,
      table.createdAt,
    ),
  ],
);

export const publishedBranches = pgTable(
  "published_branches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    publishedBy: uuid("published_by")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    branchName: text("branch_name").notNull(),
    commitSha: text("commit_sha").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("published_branches_workspace_name_idx").on(
      table.workspaceId,
      table.branchName,
    ),
  ],
);
