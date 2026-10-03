use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error("sandbox not found")]
    SandboxNotFound,
    #[error("sandbox capacity exceeded")]
    CapacityExceeded,
    #[error("sandbox guest unavailable: {0}")]
    GuestUnavailable(String),
    #[error("revision mismatch: current revision is {0}")]
    RevisionMismatch(String),
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{message}")]
    GitConflict {
        message: String,
        conflict_paths: Vec<String>,
    },
    #[error("{0}")]
    Timeout(String),
    #[error("{0}")]
    Unavailable(String),
    #[error("{0}")]
    Internal(String),
}

impl RuntimeError {
    pub fn internal(error: impl std::fmt::Display) -> Self {
        Self::Internal(error.to_string())
    }
}

impl IntoResponse for RuntimeError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::SandboxNotFound => StatusCode::NOT_FOUND,
            Self::CapacityExceeded
            | Self::Conflict(_)
            | Self::GitConflict { .. }
            | Self::RevisionMismatch(_) => StatusCode::CONFLICT,
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Timeout(_) => StatusCode::REQUEST_TIMEOUT,
            Self::Unavailable(_) | Self::GuestUnavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let body = match &self {
            Self::GitConflict { conflict_paths, .. } => serde_json::json!({
                "error": self.to_string(),
                "conflictPaths": conflict_paths
            }),
            _ => serde_json::json!({ "error": self.to_string() }),
        };
        (status, Json(body)).into_response()
    }
}

pub type Result<T> = std::result::Result<T, RuntimeError>;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRequest {
    pub workspace_id: String,
    /// Short-lived infrastructure work with no durable workspace state, such
    /// as a hosted provider-auth runner. The host may destroy it at expiry.
    #[serde(default)]
    pub ephemeral: bool,
    /// Preserve writable guest disks and release the microVM after inactivity.
    /// The workspace can be booted again from the disk checkpoint.
    #[serde(default)]
    pub hibernate_on_idle: bool,
    pub repository_url: Option<String>,
    pub repository_snapshot: Option<RepositorySnapshot>,
    pub base_sha: String,
    pub expires_at: DateTime<Utc>,
    #[serde(default)]
    pub resume_from_snapshot: bool,
    /// Existing workspaces must never silently fall back to an empty checkout.
    #[serde(default)]
    pub require_saved_state: bool,
    /// LUN of an Azure managed disk carrying the durable workspace.ext4 image.
    /// The host attaches the disk before sending this request; the orchestrator
    /// mounts it and binds the image into the Firecracker jail.
    #[serde(default)]
    pub persistent_disk_lun: Option<u32>,
    pub lifecycle: SandboxLifecycleOptions,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxLifecycleOptions {
    pub timeout_ms: u64,
    pub lifecycle: SandboxLifecycleHooks,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxLifecycleHooks {
    pub on_timeout: String,
    pub auto_resume: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositorySnapshot {
    pub files: Vec<RepositorySnapshotFile>,
    pub total_bytes: usize,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositorySnapshotFile {
    pub path: String,
    pub mode: String,
    pub content_base64: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub id: String,
    pub workspace_id: String,
    pub status: String,
    pub head_sha: String,
    pub created_at: DateTime<Utc>,
    pub last_activity_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FileResponse {
    pub path: String,
    pub contents: String,
    pub revision: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteFileRequest {
    pub path: String,
    pub contents: String,
    pub expected_revision: String,
    #[serde(default)]
    pub worktree_id: Option<String>,
    /// `mkdir -p` the write's parent directory first. Off by default, so an
    /// editor save of a path that should already exist still fails loudly
    /// rather than silently materializing a mistyped directory; callers
    /// delivering a file to a location that legitimately may not exist yet
    /// (an import staging area, a per-agent config directory) opt in instead
    /// of pairing every write with a separate `exec` to create the parent.
    #[serde(default)]
    pub create_parents: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupersetCreateEntryRequest {
    pub worktree_id: String,
    #[serde(default)]
    pub parent_path: String,
    pub name: String,
    pub kind: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupersetMoveEntryRequest {
    pub worktree_id: String,
    pub path: String,
    pub parent_path: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupersetDeleteEntryRequest {
    pub worktree_id: String,
    pub path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecRequest {
    pub command: Vec<String>,
    #[serde(default)]
    pub worktree_id: Option<String>,
    #[serde(default)]
    pub working_dir: String,
    #[serde(default)]
    pub timeout_seconds: u64,
    #[serde(default)]
    pub rows: u16,
    #[serde(default)]
    pub columns: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub codex_auth_cache_json: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResponse {
    pub output: String,
    pub exit_code: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub codex_auth_cache_json: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStartRequest {
    #[serde(default)]
    pub rows: u16,
    #[serde(default)]
    pub columns: u16,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInputRequest {
    pub data: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeRequest {
    pub rows: u16,
    pub columns: u16,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalPollRequest {
    /// Exclusive cursor: the response includes chunks at this sequence and later.
    #[serde(default)]
    pub after: u64,
    #[serde(default)]
    pub wait_milliseconds: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalChunk {
    pub sequence: u64,
    pub data: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalPollResponse {
    pub chunks: Vec<TerminalChunk>,
    /// Pass as `after` in the next poll; a chunk at this value may arrive later.
    pub next_sequence: u64,
    pub exited: bool,
    pub exit_code: Option<i32>,
}

/// One file a launched agent process needs inside its private credential
/// profile. `path` is relative to the profile directory and may not escape
/// it; the guest writes the file 0600 inside a 0700 directory it owns.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchProfileFile {
    pub path: String,
    pub contents: String,
}

/// What a launched agent process needs in order to authenticate as the
/// member, in a form that names no provider.
///
/// The exec route used to take `codexAuthCacheJson` by name, so every new
/// provider meant a new field here, in the guest, and in the host request
/// that carries it. A profile is files plus environment instead, which is the
/// whole of what a CLI needs: Codex reads an `auth.json`, Claude reads
/// `CLAUDE_CODE_OAUTH_TOKEN`, and the guest has to know neither.
///
/// Environment values may contain `{{profileDir}}`, which the guest expands
/// to the absolute path of the profile directory it created. That single
/// substitution is what lets the caller say `CODEX_HOME` without knowing
/// where the guest puts the profile.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchProfile {
    #[serde(default)]
    pub files: Vec<LaunchProfileFile>,
    #[serde(default)]
    pub env: std::collections::BTreeMap<String, String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexExecStartRequest {
    pub command: Vec<String>,
    #[serde(default)]
    pub worktree_id: Option<String>,
    #[serde(default)]
    pub working_dir: String,
    #[serde(default)]
    pub rows: u16,
    #[serde(default)]
    pub columns: u16,
    /// Superseded by `launch_profile`; kept so a control plane that has not
    /// been redeployed yet keeps working. The guest converts it into a
    /// profile at the edge, so there is only one code path below.
    #[serde(default)]
    pub codex_auth_cache_json: String,
    #[serde(default)]
    pub launch_profile: Option<LaunchProfile>,
    /// The caller's Vercel Workflow DevKit step id. A retried "start" step
    /// reuses the same id, letting the guest reattach to the still-running
    /// session instead of spawning a second Codex process.
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexExecPollRequest {
    /// Exclusive cursor: the response includes chunks at this sequence and later.
    #[serde(default)]
    pub after: u64,
    #[serde(default)]
    pub wait_milliseconds: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexExecChunk {
    pub sequence: u64,
    /// Raw PTY output bytes, base64-encoded. Never decode a single chunk on
    /// its own — a multi-byte UTF-8 character can straddle a chunk boundary.
    /// Concatenate every chunk's decoded bytes in sequence order first, then
    /// decode the full buffer to UTF-8 exactly once.
    pub data_base64: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexExecPollResponse {
    pub chunks: Vec<CodexExecChunk>,
    /// Pass as `after` in the next poll; a chunk at this value may arrive later.
    pub next_sequence: u64,
    pub exited: bool,
    pub exit_code: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub codex_auth_cache_json: Option<String>,
}

/// A terminal-agent session launched through Superset rather than executed
/// directly by the guest, per docs/SUPERSET_AGENT_SESSION_PLAN.md Phase 3.
/// `codev-guestd` validates and forwards this to Superset's host-service
/// bridge rather than running the provider process itself -- see
/// `GuestService::start_superset_agent` in guest.rs.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupersetAgentStartRequest {
    pub codev_run_id: String,
    pub codev_workspace_id: String,
    pub worktree_id: String,
    pub provider: String,
    /// Superseded by `launch_profile`; see `CodexExecStartRequest`.
    #[serde(default)]
    pub codex_auth_cache_json: Option<String>,
    #[serde(default)]
    pub launch_profile: Option<LaunchProfile>,
    pub command: Vec<String>,
    /// A retried "start" call with the same key reattaches to the run
    /// Superset already has in flight, matching `CodexExecStartRequest`'s
    /// idempotency contract.
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupersetAgentStartResponse {
    pub host_workspace_id: String,
    pub host_terminal_id: String,
    pub host_agent_session_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupersetAgentInputRequest {
    pub data: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupersetAgentPollRequest {
    /// Exclusive cursor: the response includes chunks at this sequence and later.
    #[serde(default)]
    pub after: u64,
    #[serde(default)]
    pub wait_milliseconds: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupersetAgentPollResponse {
    pub chunks: Vec<CodexExecChunk>,
    /// Pass as `after` in the next poll; a chunk at this value may arrive later.
    pub next_sequence: u64,
    pub exited: bool,
    pub exit_code: Option<i32>,
    /// Set once the launched process has exited and a refresh capture is safe.
    #[serde(default)]
    pub refresh_ready: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refreshed_codex_auth_cache: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupersetAgentStopResponse {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refreshed_codex_auth_cache: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupersetAgentRecoveryResponse {
    pub adoptable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refreshed_codex_auth_cache: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSetupStartRequest {
    /// Retries from the same web session reattach instead of spawning another
    /// interactive OAuth process.
    pub idempotency_key: String,
    #[cfg(test)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSetupCodeRequest {
    pub code: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSetupPollRequest {
    #[serde(default)]
    pub wait_milliseconds: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum ClaudeSetupPollResponse {
    Pending,
    /// `token` is the `claude setup-token` the login printed, when the CLI
    /// was asked for one.
    ///
    /// Without it the only credential a login produced was the signed-in
    /// profile left behind in the guest, which is why connecting Claude
    /// required keeping a Firecracker snapshot per member and resuming it
    /// for every turn. A token can be stored like any other credential, so
    /// the sandbox that produced it is destroyed immediately.
    ///
    /// Optional because a guest may still be running the profile-only login,
    /// and because the control plane must not fail a connection it cannot
    /// improve.
    Ready {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        token: Option<String>,
    },
    Failed {
        reason: String,
    },
}
