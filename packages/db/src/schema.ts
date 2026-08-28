import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const binary = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

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
  "hibernated",
  "stopping",
  "stopped",
  "failed",
]);
export const sandboxRuntimeStatus = pgEnum("sandbox_runtime_status", [
  "provisioning",
  "ready",
  "hibernated",
  "stopping",
  "stopped",
  "failed",
]);
export const memberRole = pgEnum("member_role", ["owner", "member"]);
export const workspaceAccessRole = pgEnum("workspace_access_role", [
  "owner",
  "co_steer",
  "reviewer",
  "viewer",
]);
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
export const agentBriefStatus = pgEnum("agent_brief_status", [
  "planning",
  "active",
  "blocked",
  "paused",
  "done",
]);
export const brainEntryKind = pgEnum("brain_entry_kind", [
  "decision",
  "attempt",
  "dead_end",
  "finding",
  "convention",
  "handoff",
]);
export const brainOverlapKind = pgEnum("brain_overlap_kind", [
  "duplicate_intent",
  "file_overlap",
  "claim_contest",
]);
export const brainOverlapStatus = pgEnum("brain_overlap_status", [
  "open",
  "acknowledged",
  "resolved",
]);
export const publicationStatus = pgEnum("publication_status", [
  "pending",
  "published",
  "failed",
]);
export const credentialScopeType = pgEnum("credential_scope_type", [
  "USER",
  "WORKSPACE",
  "ORGANIZATION",
]);
export const credentialProvider = pgEnum("credential_provider", [
  "anthropic",
  "openai",
  "bedrock",
  "azure_foundry",
  "cursor",
  "custom",
]);
export const credentialType = pgEnum("credential_type", [
  "API_KEY",
  "OAUTH_TOKEN",
  "AWS_BEDROCK_ROLE",
  "AZURE_ENDPOINT",
  "HOSTED_CODEX_SUBSCRIPTION",
]);
export const providerCredentialStatus = pgEnum("provider_credential_status", [
  "active",
  "reauthorization_required",
  "revoked",
  "failed",
]);
export const cliDeviceAuthorizationStatus = pgEnum(
  "cli_device_authorization_status",
  ["pending", "approved", "denied"],
);
export const cliClientType = pgEnum("cli_client_type", ["cli", "mobile"]);
export const mobilePlatform = pgEnum("mobile_platform", ["ios", "android"]);
export const channelMessageAuthorKind = pgEnum("channel_message_author_kind", [
  "member",
  "agent",
  "system",
]);
export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    githubUserId: bigint("github_user_id", { mode: "bigint" }),
    googleUserId: text("google_user_id"),
    clerkUserId: text("clerk_user_id"),
    login: text("login").notNull(),
    name: text("name"),
    email: text("email"),
    passwordHash: text("password_hash"),
    avatarUrl: text("avatar_url"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("users_github_user_id_idx").on(table.githubUserId),
    uniqueIndex("users_google_user_id_idx").on(table.googleUserId),
    uniqueIndex("users_clerk_user_id_idx").on(table.clerkUserId),
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
    scopeType: credentialScopeType("scope_type").notNull(),
    scopeId: uuid("scope_id").notNull(),
    provider: credentialProvider("provider").notNull(),
    credentialType: credentialType("credential_type").notNull(),
    priorityOrder: integer("priority_order").default(0).notNull(),
    encryptedApiKey: text("encrypted_api_key"),
    encryptedAccessToken: text("encrypted_access_token"),
    encryptedRefreshToken: text("encrypted_refresh_token"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    endpointUrl: text("endpoint_url"),
    awsRoleArn: text("aws_role_arn"),
    isConnected: boolean("is_connected").default(true).notNull(),
    keyVersion: integer("key_version").default(1).notNull(),
    lastFour: text("last_four"),
    status: providerCredentialStatus("status").default("active").notNull(),
    providerSubjectHash: text("provider_subject_hash"),
    encryptedMaterial: text("encrypted_material"),
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    sharingEnabled: boolean("sharing_enabled").default(false).notNull(),
    unavailableUntil: timestamp("unavailable_until", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("provider_credentials_scope_provider_type_idx").on(
      table.scopeType,
      table.scopeId,
      table.provider,
      table.credentialType,
    ),
    index("provider_credentials_scope_provider_priority_idx").on(
      table.scopeType,
      table.scopeId,
      table.provider,
      table.priorityOrder,
    ),
    index("provider_credentials_status_idx").on(table.status),
  ],
);

export const cliDeviceAuthorizations = pgTable(
  "cli_device_authorizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deviceCodeHash: text("device_code_hash").notNull(),
    userCode: text("user_code").notNull(),
    status: cliDeviceAuthorizationStatus("status").default("pending").notNull(),
    clientType: cliClientType("client_type").default("cli").notNull(),
    approvedBy: uuid("approved_by").references(() => users.id, {
      onDelete: "cascade",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("cli_device_authorizations_device_code_idx").on(
      table.deviceCodeHash,
    ),
    uniqueIndex("cli_device_authorizations_user_code_idx").on(table.userCode),
    index("cli_device_authorizations_expiry_idx").on(table.expiresAt),
  ],
);

export const cliAccessTokens = pgTable(
  "cli_access_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    tokenHash: text("token_hash").notNull(),
    name: text("name").default("CoDev CLI").notNull(),
    clientType: cliClientType("client_type").default("cli").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("cli_access_tokens_token_hash_idx").on(table.tokenHash),
    index("cli_access_tokens_user_idx").on(table.userId),
    index("cli_access_tokens_expiry_idx").on(table.expiresAt),
  ],
);

export const mobilePushTokens = pgTable(
  "mobile_push_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    expoPushToken: text("expo_push_token").notNull(),
    platform: mobilePlatform("platform").notNull(),
    deviceId: text("device_id"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("mobile_push_tokens_token_idx").on(table.expoPushToken),
    index("mobile_push_tokens_user_idx").on(table.userId),
  ],
);

export const providerCredentialEvents = pgTable(
  "provider_credential_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    credentialId: uuid("credential_id"),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    provider: credentialProvider("provider").notNull(),
    kind: text("kind").notNull(),
    type: text("type").notNull(),
    scopeType: credentialScopeType("scope_type"),
    scopeId: uuid("scope_id"),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "set null",
    }),
    result: text("result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("provider_credential_events_credential_created_idx").on(
      table.credentialId,
      table.createdAt,
    ),
    index("provider_credential_events_actor_created_idx").on(
      table.actorId,
      table.createdAt,
    ),
  ],
);

export const userEnvironmentVariables = pgTable(
  "user_environment_variables",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    encryptedValue: text("encrypted_value").notNull(),
    keyVersion: integer("key_version").default(1).notNull(),
    lastFour: text("last_four"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("user_environment_variables_user_name_idx").on(
      table.userId,
      table.name,
    ),
    index("user_environment_variables_user_updated_idx").on(
      table.userId,
      table.updatedAt,
    ),
  ],
);

export const designPartnerFeedback = pgTable(
  "design_partner_feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "set null",
    }),
    category: text("category").notNull(),
    rating: integer("rating"),
    message: text("message").notNull(),
    page: text("page"),
    release: text("release"),
    status: text("status").default("new").notNull(),
    ...timestamps,
  },
  (table) => [
    index("design_partner_feedback_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    index("design_partner_feedback_status_created_idx").on(
      table.status,
      table.createdAt,
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
    }),
    githubRepositoryId: bigint("github_repository_id", {
      mode: "bigint",
    }),
    repository: text("repository").notNull(),
    repositoryVisibility: text("repository_visibility")
      .default("public")
      .notNull(),
    defaultBranch: text("default_branch").notNull(),
    baseSha: text("base_sha").notNull(),
    status: workspaceStatus("status").default("pending").notNull(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    hibernateAt: timestamp("hibernate_at", { withTimezone: true }),
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
    provisionedHeadSha: text("provisioned_head_sha"),
    snapshotRef: text("snapshot_ref"),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    hibernatedAt: timestamp("hibernated_at", { withTimezone: true }),
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
    accessRole: workspaceAccessRole("access_role").default("viewer").notNull(),
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
    inviteeEmail: text("invitee_email"),
    inviteeLogin: text("invitee_login"),
    accessRole: workspaceAccessRole("access_role").default("viewer").notNull(),
    allowLink: boolean("allow_link").default(false).notNull(),
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
    model: text("model").notNull().default("gpt-5"),
    provider: text("provider").notNull().default("openai"),
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

export type AgentTurnAttachment = {
  name: string;
  type: string;
  size: number;
  text?: string;
  data?: string;
};

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
    attachments: jsonb("attachments")
      .$type<AgentTurnAttachment[]>()
      .default([])
      .notNull(),
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

export type AgentBriefPlanStep = {
  label: string;
  state: "done" | "active" | "pending";
};

/**
 * The workspace brain's live face: one mutable row per agent session that
 * declares, in the owner's language, what that agent is trying to accomplish.
 * Agents publish this right after planning — before they hold a single path
 * claim — so overlap between two agents' *intent* can be seen early.
 */
export const agentBriefs = pgTable(
  "agent_briefs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    sessionId: uuid("session_id")
      .references(() => agentSessions.id, { onDelete: "cascade" })
      .notNull(),
    goal: text("goal").notNull().default(""),
    approachSummary: text("approach_summary").notNull().default(""),
    planSteps: jsonb("plan_steps")
      .$type<AgentBriefPlanStep[]>()
      .default([])
      .notNull(),
    currentStep: text("current_step").notNull().default(""),
    filesLikelyToTouch: jsonb("files_likely_to_touch")
      .$type<string[]>()
      .default([])
      .notNull(),
    keywords: jsonb("keywords").$type<string[]>().default([]).notNull(),
    status: agentBriefStatus("status").default("planning").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("agent_briefs_session_idx").on(table.sessionId),
    index("agent_briefs_workspace_status_idx").on(
      table.workspaceId,
      table.status,
    ),
  ],
);

/**
 * The workspace brain's durable face: an append-only log of decisions,
 * attempts, dead ends and findings that outlives the worktree it came from,
 * so a later agent can learn what was already tried instead of repeating it.
 */
export const brainEntries = pgTable(
  "brain_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    sessionId: uuid("session_id").references(() => agentSessions.id, {
      onDelete: "set null",
    }),
    authorId: uuid("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    kind: brainEntryKind("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    paths: jsonb("paths").$type<string[]>().default([]).notNull(),
    keywords: jsonb("keywords").$type<string[]>().default([]).notNull(),
    supersedesId: uuid("supersedes_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("brain_entries_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    index("brain_entries_workspace_kind_idx").on(table.workspaceId, table.kind),
  ],
);

/**
 * A detected risk that two agent sessions are colliding — same intent, same
 * files, or a contested claim. The pair is always stored with the
 * lexicographically smaller session id on the left so a pair has one row per
 * kind. Warn-only: recorded and surfaced, never blocking.
 */
export const brainOverlaps = pgTable(
  "brain_overlaps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    leftSessionId: uuid("left_session_id")
      .references(() => agentSessions.id, { onDelete: "cascade" })
      .notNull(),
    rightSessionId: uuid("right_session_id")
      .references(() => agentSessions.id, { onDelete: "cascade" })
      .notNull(),
    kind: brainOverlapKind("kind").notNull(),
    score: real("score").notNull().default(0),
    evidence: jsonb("evidence")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    rationale: text("rationale").notNull().default(""),
    status: brainOverlapStatus("status").default("open").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("brain_overlaps_pair_kind_idx").on(
      table.workspaceId,
      table.leftSessionId,
      table.rightSessionId,
      table.kind,
    ),
    index("brain_overlaps_workspace_status_idx").on(
      table.workspaceId,
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

export const workspaceStateDocuments = pgTable(
  "workspace_state_documents",
  {
    documentName: text("document_name").primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    state: binary("state").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("workspace_state_documents_workspace_idx").on(table.workspaceId),
  ],
);

export const workspaceSnapshots = pgTable(
  "workspace_snapshots",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    headSha: text("head_sha").notNull(),
    snapshot: jsonb("snapshot")
      .$type<{
        files: Array<{
          path: string;
          mode: "100644" | "100755" | "120000";
          contentBase64: string;
        }>;
        totalBytes: number;
      }>()
      .notNull(),
    totalBytes: integer("total_bytes").notNull(),
    ...timestamps,
  },
  (table) => [index("workspace_snapshots_updated_idx").on(table.updatedAt)],
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
    status: publicationStatus("status").default("pending").notNull(),
    sourceHeadSha: text("source_head_sha").notNull(),
    baseSha: text("base_sha").notNull(),
    commitSha: text("commit_sha"),
    repositoryId: bigint("repository_id", { mode: "bigint" }).notNull(),
    remoteRef: text("remote_ref").notNull(),
    htmlUrl: text("html_url"),
    pullRequestNumber: integer("pull_request_number"),
    pullRequestUrl: text("pull_request_url"),
    requestId: text("request_id").notNull(),
    lastError: text("last_error"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("published_branches_workspace_name_idx").on(
      table.workspaceId,
      table.branchName,
    ),
    uniqueIndex("published_branches_workspace_request_idx").on(
      table.workspaceId,
      table.requestId,
    ),
    index("published_branches_workspace_status_idx").on(
      table.workspaceId,
      table.status,
      table.updatedAt,
    ),
  ],
);

export const userComputeUsage = pgTable("user_compute_usage", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  minutesUsed: integer("minutes_used").default(0).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Human conversation inside a workspace. Distinct from `coordinationMessages`,
 * which is the agent-to-agent negotiation channel: these rows are what the
 * team says to each other, and agents read them as context rather than
 * driving them.
 */
export const workspaceChannels = pgTable(
  "workspace_channels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    slug: text("slug").notNull(),
    topic: text("topic"),
    /** Agents may read and post here. Off makes a channel human-only. */
    agentAccess: boolean("agent_access").default(true).notNull(),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("workspace_channels_workspace_slug_idx").on(
      table.workspaceId,
      table.slug,
    ),
    index("workspace_channels_workspace_idx").on(
      table.workspaceId,
      table.archivedAt,
    ),
  ],
);

export const workspaceChannelMessages = pgTable(
  "workspace_channel_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    channelId: uuid("channel_id")
      .references(() => workspaceChannels.id, { onDelete: "cascade" })
      .notNull(),
    /** Denormalized so a workspace-wide digest for agents is one query. */
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    authorKind: channelMessageAuthorKind("author_kind")
      .default("member")
      .notNull(),
    /** Null for agent and system posts, which have no CoDev user row. */
    authorId: uuid("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Display name for non-member authors, e.g. the agent's own name. */
    authorLabel: text("author_label"),
    agentSessionId: uuid("agent_session_id").references(
      () => agentSessions.id,
      { onDelete: "set null" },
    ),
    body: text("body").notNull(),
    /** Member user ids mentioned in `body`, resolved at post time. */
    mentions: jsonb("mentions").$type<string[]>().default([]).notNull(),
    /** The post asked the agent for something, not just a teammate. */
    mentionsAgent: boolean("mentions_agent").default(false).notNull(),
    ...timestamps,
  },
  (table) => [
    index("workspace_channel_messages_channel_idx").on(
      table.channelId,
      table.createdAt,
    ),
    index("workspace_channel_messages_workspace_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
);

export const workspaceChannelReads = pgTable(
  "workspace_channel_reads",
  {
    channelId: uuid("channel_id")
      .references(() => workspaceChannels.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    lastReadAt: timestamp("last_read_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.channelId, table.userId] }),
    index("workspace_channel_reads_user_idx").on(table.userId),
  ],
);

/**
 * A member's own answer to "what are you working on". Editor presence is
 * inferred and expires in Redis; this is deliberate, durable, and theirs.
 */
export const workspaceMemberStatuses = pgTable(
  "workspace_member_statuses",
  {
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    emoji: text("emoji"),
    headline: text("headline"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index("workspace_member_statuses_workspace_idx").on(table.workspaceId),
  ],
);

/**
 * Short-lived ownership of one terminal-backed chat composer. The row is a
 * lease rather than a permanent lock so a closed or disconnected browser can
 * never strand a shared workspace.
 */
export const workspaceChatLeases = pgTable(
  "workspace_chat_leases",
  {
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    chatId: text("chat_id").notNull(),
    holderId: uuid("holder_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    clientId: text("client_id").notNull(),
    leaseToken: text("lease_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.chatId] }),
    index("workspace_chat_leases_expiry_idx").on(table.expiresAt),
  ],
);

/**
 * Ephemeral viewers of a shared chat. Heartbeats expire automatically; the
 * rows are only used to render truthful collaborator presence.
 */
export const workspaceChatParticipants = pgTable(
  "workspace_chat_participants",
  {
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    chatId: text("chat_id").notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    clientId: text("client_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.chatId, table.userId, table.clientId],
    }),
    index("workspace_chat_participants_expiry_idx").on(table.expiresAt),
  ],
);

export type WorkspaceChatPromptAttachment = {
  name: string;
  type: string;
};

/**
 * Durable attribution for prompts written into the shared terminal. The
 * provider transcript remains the source of truth for content and output;
 * these receipts let every viewer identify who submitted each user turn.
 */
export const workspaceChatPromptReceipts = pgTable(
  "workspace_chat_prompt_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    chatId: text("chat_id").notNull(),
    authorId: uuid("author_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    clientMessageId: uuid("client_message_id").notNull(),
    prompt: text("prompt").notNull(),
    attachments: jsonb("attachments")
      .$type<WorkspaceChatPromptAttachment[]>()
      .default([])
      .notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    effort: text("effort"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("workspace_chat_prompt_receipts_client_message_idx").on(
      table.workspaceId,
      table.chatId,
      table.clientMessageId,
    ),
    index("workspace_chat_prompt_receipts_chat_created_idx").on(
      table.workspaceId,
      table.chatId,
      table.createdAt,
    ),
  ],
);

export const sandboxRuntimeIntervals = pgTable(
  "sandbox_runtime_intervals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    source: text("source").notNull(),
    ...timestamps,
  },
  (table) => [
    index("sandbox_runtime_intervals_user_open_idx").on(
      table.userId,
      table.endedAt,
    ),
    index("sandbox_runtime_intervals_workspace_open_idx").on(
      table.workspaceId,
      table.endedAt,
    ),
  ],
);
