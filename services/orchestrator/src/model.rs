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
    pub repository_url: Option<String>,
    pub repository_snapshot: Option<RepositorySnapshot>,
    pub base_sha: String,
    pub expires_at: DateTime<Utc>,
    #[serde(default)]
    pub resume_from_snapshot: bool,
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
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeCreateRequest {
    pub worktree_id: String,
    pub head_sha: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch_name: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeCheckpointRequest {
    pub expected_head_sha: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeCheckpointResponse {
    pub head_sha: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeReviewResponse {
    pub base_sha: String,
    pub head_sha: String,
    pub diff: String,
    pub diff_digest: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRebaseRequest {
    pub expected_head_sha: String,
    pub onto_sha: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRebaseResponse {
    pub head_sha: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeMergeRequest {
    pub expected_integration_head_sha: String,
    pub expected_worktree_head_sha: String,
    pub expected_diff_digest: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeMergeResponse {
    pub head_sha: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicationExportRequest {
    pub expected_head_sha: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicationFile {
    pub path: String,
    pub mode: String,
    pub content_base64: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicationExportResponse {
    pub head_sha: String,
    pub files: Vec<PublicationFile>,
    pub total_bytes: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResponse {
    pub output: String,
    pub exit_code: i32,
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
    pub next_sequence: u64,
    pub exited: bool,
    pub exit_code: Option<i32>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeStartRequest {
    pub project_root: String,
    /// Present only when the workspace's clone directory may not exist yet
    /// on the host. Moving the clone here (instead of the control plane
    /// running it over SSM) means Vercel never needs host shell access for
    /// Orca at all; the orchestrator idempotently no-ops if the directory is
    /// already a git repository.
    pub clone: Option<IdeCloneRequest>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeCloneRequest {
    pub repository: String,
    pub default_branch: String,
    /// A short-lived GitHub token for the initial clone of a private repo
    /// only; the orchestrator drops it from the persisted `origin` remote
    /// immediately after cloning, mirroring the SSM script it replaces.
    pub token: Option<String>,
}

/// A running per-workspace Orca IDE process. `ready` is the verbatim
/// `orca_server_ready` JSON object the process printed on startup; the
/// control plane already knows how to validate and parse that shape
/// (`orcaReadySchema` in `apps/web/lib/orca-pairing.ts`), so the orchestrator
/// passes it through rather than re-implementing that parsing in Rust.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeSession {
    pub workspace_id: String,
    pub port: u16,
    pub created_at: DateTime<Utc>,
    pub last_activity_at: DateTime<Utc>,
    pub ready: serde_json::Value,
}
