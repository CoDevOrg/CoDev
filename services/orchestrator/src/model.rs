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
            Self::CapacityExceeded | Self::Conflict(_) | Self::RevisionMismatch(_) => {
                StatusCode::CONFLICT
            }
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Timeout(_) => StatusCode::REQUEST_TIMEOUT,
            Self::Unavailable(_) | Self::GuestUnavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            Json(serde_json::json!({ "error": self.to_string() })),
        )
            .into_response()
    }
}

pub type Result<T> = std::result::Result<T, RuntimeError>;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRequest {
    pub workspace_id: String,
    pub repository_url: String,
    pub base_sha: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub id: String,
    pub workspace_id: String,
    pub status: String,
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
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecRequest {
    pub command: Vec<String>,
    #[serde(default)]
    pub working_dir: String,
    #[serde(default)]
    pub timeout_seconds: u64,
    #[serde(default)]
    pub rows: u16,
    #[serde(default)]
    pub columns: u16,
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
