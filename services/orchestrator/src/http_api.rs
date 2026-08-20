use std::{
    collections::HashSet, path::Component, path::Path as FilePath, sync::OnceLock, time::Instant,
};

use axum::{
    Extension, Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderValue, Request, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use chrono::{Duration, Utc};
use regex::Regex;
use serde::Deserialize;
use tracing::info;

use crate::{
    backend::{IdeBackend, SharedBackend},
    model::{
        CodexExecPollRequest, CodexExecStartRequest, CreateRequest, ExecRequest, IdeStartRequest,
        PublicationExportRequest, Result, RuntimeError, TerminalInputRequest, TerminalPollRequest,
        TerminalResizeRequest, TerminalStartRequest, WorktreeCheckpointRequest,
        WorktreeCreateRequest, WorktreeMergeRequest, WorktreeRebaseRequest, WriteFileRequest,
    },
};

const MAX_REQUEST_BYTES: usize = 5 << 20;

#[derive(Deserialize)]
struct FileRequest {
    path: String,
    #[serde(default, rename = "worktreeId")]
    worktree_id: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeQuery {
    worktree_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeReviewQuery {
    base_sha: String,
}

pub fn router(backend: SharedBackend, ide: IdeBackend) -> Router {
    Router::new()
        .route("/healthz", get(health))
        .route("/v1/sandboxes", post(create_sandbox))
        .route(
            "/v1/sandboxes/{workspace_id}",
            get(get_sandbox).delete(destroy_sandbox),
        )
        .route("/v1/sandboxes/{workspace_id}/resume", post(resume_sandbox))
        .route("/v1/sandboxes/{workspace_id}/activity", post(touch_sandbox))
        .route(
            "/v1/sandboxes/{workspace_id}/ide",
            post(start_ide).get(get_ide).delete(stop_ide),
        )
        .route("/v1/sandboxes/{workspace_id}/files/read", post(read_file))
        .route("/v1/sandboxes/{workspace_id}/files/write", post(write_file))
        .route("/v1/sandboxes/{workspace_id}/pty/exec", post(exec_pty))
        .route(
            "/v1/sandboxes/{workspace_id}/worktrees",
            post(create_worktree),
        )
        .route(
            "/v1/sandboxes/{workspace_id}/worktrees/{worktree_id}",
            delete(delete_worktree),
        )
        .route(
            "/v1/sandboxes/{workspace_id}/worktrees/{worktree_id}/checkpoint",
            post(checkpoint_worktree),
        )
        .route(
            "/v1/sandboxes/{workspace_id}/worktrees/{worktree_id}/review",
            get(review_worktree),
        )
        .route(
            "/v1/sandboxes/{workspace_id}/worktrees/{worktree_id}/rebase",
            post(rebase_worktree),
        )
        .route(
            "/v1/sandboxes/{workspace_id}/worktrees/{worktree_id}/merge",
            post(merge_worktree),
        )
        .route(
            "/v1/sandboxes/{workspace_id}/terminals",
            post(start_terminal),
        )
        .route(
            "/v1/sandboxes/{workspace_id}/terminals/{session_id}/input",
            post(input_terminal),
        )
        .route(
            "/v1/sandboxes/{workspace_id}/terminals/{session_id}/resize",
            post(resize_terminal),
        )
        .route(
            "/v1/sandboxes/{workspace_id}/terminals/{session_id}/poll",
            post(poll_terminal),
        )
        .route(
            "/v1/sandboxes/{workspace_id}/terminals/{session_id}",
            delete(close_terminal),
        )
        .route(
            "/v1/sandboxes/{workspace_id}/codex-execs",
            post(start_codex_exec),
        )
        .route(
            "/v1/sandboxes/{workspace_id}/codex-execs/{session_id}/poll",
            post(poll_codex_exec),
        )
        .route(
            "/v1/sandboxes/{workspace_id}/codex-execs/{session_id}",
            delete(close_codex_exec),
        )
        .route("/v1/sandboxes/{workspace_id}/git/status", get(git_status))
        .route("/v1/sandboxes/{workspace_id}/git/diff", get(git_diff))
        .route(
            "/v1/sandboxes/{workspace_id}/publication/export",
            post(export_publication),
        )
        .route(
            "/v1/sandboxes/{workspace_id}/snapshot",
            post(snapshot_workspace).delete(discard_snapshot),
        )
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .layer(Extension(ide))
        .layer(middleware::from_fn(no_store))
        .layer(middleware::from_fn(observe_request))
        .with_state(backend)
}

async fn observe_request(request: Request<Body>, next: Next) -> Response {
    let started_at = Instant::now();
    let request_id = request
        .headers()
        .get("x-codev-request-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.len() <= 128)
        .unwrap_or("missing")
        .to_owned();
    let method = request.method().to_string();
    let path = request.uri().path().to_owned();
    let mut response = next.run(request).await;
    if let Ok(value) = HeaderValue::from_str(&request_id) {
        response.headers_mut().insert("x-codev-request-id", value);
    }
    info!(
        event = "http.request",
        %request_id,
        %method,
        %path,
        status = response.status().as_u16(),
        duration_ms = started_at.elapsed().as_millis() as u64
    );
    response
}

async fn no_store(request: Request<Body>, next: Next) -> Response {
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

async fn health(State(backend): State<SharedBackend>) -> Result<Json<serde_json::Value>> {
    backend.health().await?;
    Ok(Json(serde_json::json!({
        "status": "ok",
        "service": "codev-orchestrator",
        "activeSandboxes": backend.active_count().await,
    })))
}

async fn create_sandbox(
    State(backend): State<SharedBackend>,
    Json(request): Json<CreateRequest>,
) -> Result<impl IntoResponse> {
    validate_create(&request)?;
    let instance = backend.create(request).await?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "sandbox": instance })),
    ))
}

async fn get_sandbox(
    State(backend): State<SharedBackend>,
    Path(workspace_id): Path<String>,
) -> Result<Json<serde_json::Value>> {
    validate_workspace_id(&workspace_id)?;
    let instance = backend.get(&workspace_id).await?;
    Ok(Json(serde_json::json!({ "sandbox": instance })))
}

async fn touch_sandbox(
    State(backend): State<SharedBackend>,
    Path(workspace_id): Path<String>,
) -> Result<Json<serde_json::Value>> {
    validate_workspace_id(&workspace_id)?;
    let instance = backend.touch(&workspace_id).await?;
    Ok(Json(serde_json::json!({ "sandbox": instance })))
}

async fn destroy_sandbox(
    State(backend): State<SharedBackend>,
    Path(workspace_id): Path<String>,
) -> Result<StatusCode> {
    validate_workspace_id(&workspace_id)?;
    backend.destroy(&workspace_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn resume_sandbox(
    State(backend): State<SharedBackend>,
    Path(workspace_id): Path<String>,
) -> Result<StatusCode> {
    validate_workspace_id(&workspace_id)?;
    backend.resume(&workspace_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn discard_snapshot(
    State(backend): State<SharedBackend>,
    Path(workspace_id): Path<String>,
) -> Result<StatusCode> {
    validate_workspace_id(&workspace_id)?;
    backend.discard_snapshot(&workspace_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn read_file(
    State(backend): State<SharedBackend>,
    Path(workspace_id): Path<String>,
    Json(request): Json<FileRequest>,
) -> Result<Json<serde_json::Value>> {
    validate_workspace_id(&workspace_id)?;
    validate_optional_worktree_id(request.worktree_id.as_deref())?;
    let file = backend
        .read_file(&workspace_id, request.path, request.worktree_id.as_deref())
        .await?;
    Ok(Json(serde_json::json!({ "file": file })))
}

async fn write_file(
    State(backend): State<SharedBackend>,
    Path(workspace_id): Path<String>,
    Json(request): Json<WriteFileRequest>,
) -> Result<Json<serde_json::Value>> {
    validate_workspace_id(&workspace_id)?;
    validate_optional_worktree_id(request.worktree_id.as_deref())?;
    let revision = backend.write_file(&workspace_id, request).await?;
    Ok(Json(serde_json::json!({ "revision": revision })))
}

async fn exec_pty(
    State(backend): State<SharedBackend>,
    Path(workspace_id): Path<String>,
    Json(request): Json<ExecRequest>,
) -> Result<Json<serde_json::Value>> {
    validate_workspace_id(&workspace_id)?;
    validate_optional_worktree_id(request.worktree_id.as_deref())?;
    if request.command.is_empty() || request.command.len() > 32 {
        return Err(RuntimeError::BadRequest(
            "command must contain between 1 and 32 arguments".into(),
        ));
    }
    let max_timeout = if request.codex_auth_cache_json.is_some() {
        900
    } else {
        60
    };
    if request.timeout_seconds > max_timeout {
        return Err(RuntimeError::BadRequest(
            "command timeout exceeds the allowed limit".into(),
        ));
    }
    let result = backend.exec(&workspace_id, request).await?;
    Ok(Json(serde_json::json!({ "result": result })))
}

async fn create_worktree(
    State(backend): State<SharedBackend>,
    Path(workspace_id): Path<String>,
    Json(request): Json<WorktreeCreateRequest>,
) -> Result<impl IntoResponse> {
    validate_workspace_id(&workspace_id)?;
    validate_worktree_id(&request.worktree_id)?;
    if !commit_sha_pattern().is_match(&request.head_sha) {
        return Err(RuntimeError::BadRequest("invalid worktree head SHA".into()));
    }
    backend.create_worktree(&workspace_id, request).await?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "created": true })),
    ))
}

async fn delete_worktree(
    State(backend): State<SharedBackend>,
    Path((workspace_id, worktree_id)): Path<(String, String)>,
) -> Result<StatusCode> {
    validate_workspace_id(&workspace_id)?;
    validate_worktree_id(&worktree_id)?;
    backend.delete_worktree(&workspace_id, &worktree_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn checkpoint_worktree(
    State(backend): State<SharedBackend>,
    Path((workspace_id, worktree_id)): Path<(String, String)>,
    Json(request): Json<WorktreeCheckpointRequest>,
) -> Result<Json<serde_json::Value>> {
    validate_workspace_id(&workspace_id)?;
    validate_worktree_id(&worktree_id)?;
    validate_sha(&request.expected_head_sha, "expected worktree head SHA")?;
    let response = backend
        .checkpoint_worktree(&workspace_id, &worktree_id, request)
        .await?;
    Ok(Json(
        serde_json::to_value(response).map_err(RuntimeError::internal)?,
    ))
}

async fn review_worktree(
    State(backend): State<SharedBackend>,
    Path((workspace_id, worktree_id)): Path<(String, String)>,
    Query(query): Query<WorktreeReviewQuery>,
) -> Result<Json<serde_json::Value>> {
    validate_workspace_id(&workspace_id)?;
    validate_worktree_id(&worktree_id)?;
    validate_sha(&query.base_sha, "review base SHA")?;
    let response = backend
        .review_worktree(&workspace_id, &worktree_id, &query.base_sha)
        .await?;
    Ok(Json(
        serde_json::to_value(response).map_err(RuntimeError::internal)?,
    ))
}

async fn rebase_worktree(
    State(backend): State<SharedBackend>,
    Path((workspace_id, worktree_id)): Path<(String, String)>,
    Json(request): Json<WorktreeRebaseRequest>,
) -> Result<Json<serde_json::Value>> {
    validate_workspace_id(&workspace_id)?;
    validate_worktree_id(&worktree_id)?;
    validate_sha(&request.expected_head_sha, "expected worktree head SHA")?;
    validate_sha(&request.onto_sha, "rebase target SHA")?;
    let response = backend
        .rebase_worktree(&workspace_id, &worktree_id, request)
        .await?;
    Ok(Json(
        serde_json::to_value(response).map_err(RuntimeError::internal)?,
    ))
}

async fn merge_worktree(
    State(backend): State<SharedBackend>,
    Path((workspace_id, worktree_id)): Path<(String, String)>,
    Json(request): Json<WorktreeMergeRequest>,
) -> Result<Json<serde_json::Value>> {
    validate_workspace_id(&workspace_id)?;
    validate_worktree_id(&worktree_id)?;
    validate_sha(
        &request.expected_integration_head_sha,
        "expected integration head SHA",
    )?;
    validate_sha(
        &request.expected_worktree_head_sha,
        "expected worktree head SHA",
    )?;
    if !digest_pattern().is_match(&request.expected_diff_digest) {
        return Err(RuntimeError::BadRequest(
            "invalid expected diff digest".into(),
        ));
    }
    let response = backend
        .merge_worktree(&workspace_id, &worktree_id, request)
        .await?;
    Ok(Json(
        serde_json::to_value(response).map_err(RuntimeError::internal)?,
    ))
}

async fn export_publication(
    State(backend): State<SharedBackend>,
    Path(workspace_id): Path<String>,
    Json(request): Json<PublicationExportRequest>,
) -> Result<Json<serde_json::Value>> {
    validate_workspace_id(&workspace_id)?;
    validate_sha(&request.expected_head_sha, "expected integration head SHA")?;
    let response = backend.export_publication(&workspace_id, request).await?;
    Ok(Json(
        serde_json::to_value(response).map_err(RuntimeError::internal)?,
    ))
}

async fn snapshot_workspace(
    State(backend): State<SharedBackend>,
    Path(workspace_id): Path<String>,
    Json(request): Json<PublicationExportRequest>,
) -> Result<Json<serde_json::Value>> {
    validate_workspace_id(&workspace_id)?;
    validate_sha(&request.expected_head_sha, "expected integration head SHA")?;
    let response = backend.snapshot_workspace(&workspace_id, request).await?;
    Ok(Json(
        serde_json::to_value(response).map_err(RuntimeError::internal)?,
    ))
}

async fn start_terminal(
    State(backend): State<SharedBackend>,
    Path(workspace_id): Path<String>,
    Json(request): Json<TerminalStartRequest>,
) -> Result<impl IntoResponse> {
    validate_workspace_id(&workspace_id)?;
    let session_id = backend.start_terminal(&workspace_id, request).await?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "sessionId": session_id })),
    ))
}

async fn input_terminal(
    State(backend): State<SharedBackend>,
    Path((workspace_id, session_id)): Path<(String, String)>,
    Json(request): Json<TerminalInputRequest>,
) -> Result<StatusCode> {
    validate_workspace_id(&workspace_id)?;
    validate_terminal_id(&session_id)?;
    backend
        .input_terminal(&workspace_id, &session_id, request)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn resize_terminal(
    State(backend): State<SharedBackend>,
    Path((workspace_id, session_id)): Path<(String, String)>,
    Json(request): Json<TerminalResizeRequest>,
) -> Result<StatusCode> {
    validate_workspace_id(&workspace_id)?;
    validate_terminal_id(&session_id)?;
    backend
        .resize_terminal(&workspace_id, &session_id, request)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn poll_terminal(
    State(backend): State<SharedBackend>,
    Path((workspace_id, session_id)): Path<(String, String)>,
    Json(request): Json<TerminalPollRequest>,
) -> Result<Json<serde_json::Value>> {
    validate_workspace_id(&workspace_id)?;
    validate_terminal_id(&session_id)?;
    let result = backend
        .poll_terminal(&workspace_id, &session_id, request)
        .await?;
    Ok(Json(serde_json::json!({ "result": result })))
}

async fn close_terminal(
    State(backend): State<SharedBackend>,
    Path((workspace_id, session_id)): Path<(String, String)>,
) -> Result<StatusCode> {
    validate_workspace_id(&workspace_id)?;
    validate_terminal_id(&session_id)?;
    backend.close_terminal(&workspace_id, &session_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn start_codex_exec(
    State(backend): State<SharedBackend>,
    Path(workspace_id): Path<String>,
    Json(request): Json<CodexExecStartRequest>,
) -> Result<impl IntoResponse> {
    validate_workspace_id(&workspace_id)?;
    validate_optional_worktree_id(request.worktree_id.as_deref())?;
    if request.command.is_empty() || request.command.len() > 32 {
        return Err(RuntimeError::BadRequest(
            "command must contain between 1 and 32 arguments".into(),
        ));
    }
    let session_id = backend.start_codex_exec(&workspace_id, request).await?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "sessionId": session_id })),
    ))
}

async fn poll_codex_exec(
    State(backend): State<SharedBackend>,
    Path((workspace_id, session_id)): Path<(String, String)>,
    Json(request): Json<CodexExecPollRequest>,
) -> Result<Json<serde_json::Value>> {
    validate_workspace_id(&workspace_id)?;
    validate_codex_exec_id(&session_id)?;
    let result = backend
        .poll_codex_exec(&workspace_id, &session_id, request)
        .await?;
    Ok(Json(serde_json::json!({ "result": result })))
}

async fn close_codex_exec(
    State(backend): State<SharedBackend>,
    Path((workspace_id, session_id)): Path<(String, String)>,
) -> Result<StatusCode> {
    validate_workspace_id(&workspace_id)?;
    validate_codex_exec_id(&session_id)?;
    backend
        .close_codex_exec(&workspace_id, &session_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn git_status(
    State(backend): State<SharedBackend>,
    Path(workspace_id): Path<String>,
    Query(query): Query<WorktreeQuery>,
) -> Result<Json<serde_json::Value>> {
    validate_workspace_id(&workspace_id)?;
    validate_optional_worktree_id(query.worktree_id.as_deref())?;
    let output = backend
        .git_status(&workspace_id, query.worktree_id.as_deref())
        .await?;
    Ok(Json(serde_json::json!({ "output": output })))
}

async fn git_diff(
    State(backend): State<SharedBackend>,
    Path(workspace_id): Path<String>,
    Query(query): Query<WorktreeQuery>,
) -> Result<Json<serde_json::Value>> {
    validate_workspace_id(&workspace_id)?;
    validate_optional_worktree_id(query.worktree_id.as_deref())?;
    let output = backend
        .git_diff(&workspace_id, query.worktree_id.as_deref())
        .await?;
    Ok(Json(serde_json::json!({ "output": output })))
}

async fn start_ide(
    Extension(ide): Extension<IdeBackend>,
    Path(workspace_id): Path<String>,
    Json(request): Json<IdeStartRequest>,
) -> Result<impl IntoResponse> {
    validate_workspace_id(&workspace_id)?;
    if request.project_root.is_empty() || request.project_root.len() > 4_096 {
        return Err(RuntimeError::BadRequest("invalid project root".into()));
    }
    if let Some(clone) = &request.clone {
        if clone.repository.is_empty() || clone.repository.len() > 256 {
            return Err(RuntimeError::BadRequest("invalid repository".into()));
        }
        if clone.default_branch.is_empty() || clone.default_branch.len() > 256 {
            return Err(RuntimeError::BadRequest("invalid default branch".into()));
        }
        if clone.token.as_ref().is_some_and(|token| token.len() > 512) {
            return Err(RuntimeError::BadRequest("invalid token".into()));
        }
    }
    if let Some(codex_auth_cache_json) = &request.codex_auth_cache_json
        && (codex_auth_cache_json.len() > (128 << 10)
            || !serde_json::from_str::<serde_json::Value>(codex_auth_cache_json)
                .is_ok_and(|value| value.is_object()))
    {
        return Err(RuntimeError::BadRequest(
            "Codex auth cache is invalid or too large".into(),
        ));
    }
    if request
        .anthropic_api_key
        .as_ref()
        .is_some_and(|value| value.is_empty() || value.len() > 512)
        || request
            .claude_code_oauth_token
            .as_ref()
            .is_some_and(|value| value.is_empty() || value.len() > 512)
    {
        return Err(RuntimeError::BadRequest(
            "invalid Anthropic credential".into(),
        ));
    }
    let session = ide.start(&workspace_id, request).await?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "ide": session })),
    ))
}

async fn get_ide(
    Extension(ide): Extension<IdeBackend>,
    Path(workspace_id): Path<String>,
) -> Result<Json<serde_json::Value>> {
    validate_workspace_id(&workspace_id)?;
    let session = ide.status(&workspace_id).await?;
    Ok(Json(serde_json::json!({ "ide": session })))
}

async fn stop_ide(
    Extension(ide): Extension<IdeBackend>,
    Path(workspace_id): Path<String>,
) -> Result<StatusCode> {
    validate_workspace_id(&workspace_id)?;
    ide.stop(&workspace_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

fn validate_create(request: &CreateRequest) -> Result<()> {
    validate_workspace_id(&request.workspace_id)?;
    if !commit_sha_pattern().is_match(&request.base_sha) {
        return Err(RuntimeError::BadRequest("invalid base SHA".into()));
    }
    if request.repository_url.is_some() == request.repository_snapshot.is_some() {
        return Err(RuntimeError::BadRequest(
            "provide exactly one repository source".into(),
        ));
    }
    let lifecycle = &request.lifecycle;
    if lifecycle.timeout_ms != 14_400_000
        || lifecycle.lifecycle.on_timeout != "pause"
        || !lifecycle.lifecycle.auto_resume
    {
        return Err(RuntimeError::BadRequest(
            "sandbox lifecycle must pause and auto-resume after four hours".into(),
        ));
    }
    if let Some(repository_url) = &request.repository_url {
        let repository = repository_url
            .strip_prefix("https://github.com/")
            .and_then(|value| value.strip_suffix(".git"));
        if repository.is_none()
            || repository
                .expect("checked")
                .split('/')
                .any(|segment| segment.is_empty() || segment == "." || segment == "..")
        {
            return Err(RuntimeError::BadRequest(
                "repository URL must be a public GitHub HTTPS clone URL".into(),
            ));
        }
    }
    if let Some(snapshot) = &request.repository_snapshot {
        if snapshot.files.len() > 500 || snapshot.total_bytes > 3 * 1_024 * 1_024 {
            return Err(RuntimeError::BadRequest(
                "repository snapshot exceeds its limits".into(),
            ));
        }
        let mut paths = HashSet::new();
        let mut total_bytes = 0usize;
        for file in &snapshot.files {
            let path = FilePath::new(&file.path);
            if file.path.is_empty()
                || file.path.len() > 4_096
                || file.path.contains('\0')
                || path.is_absolute()
                || path.components().any(|component| match component {
                    Component::Normal(segment) => segment.eq_ignore_ascii_case(".git"),
                    _ => true,
                })
                || !paths.insert(file.path.as_str())
                || !matches!(file.mode.as_str(), "100644" | "100755" | "120000")
            {
                return Err(RuntimeError::BadRequest(
                    "repository snapshot contains an unsafe entry".into(),
                ));
            }
            let decoded = BASE64
                .decode(&file.content_base64)
                .map_err(|_| RuntimeError::BadRequest("invalid snapshot base64".into()))?;
            if decoded.len() > 1_024 * 1_024 {
                return Err(RuntimeError::BadRequest(
                    "repository snapshot file exceeds 1 MiB".into(),
                ));
            }
            total_bytes = total_bytes
                .checked_add(decoded.len())
                .ok_or_else(|| RuntimeError::BadRequest("snapshot size overflow".into()))?;
        }
        if total_bytes != snapshot.total_bytes {
            return Err(RuntimeError::BadRequest(
                "repository snapshot size does not match its contents".into(),
            ));
        }
    }
    let now = Utc::now();
    if request.expires_at <= now || request.expires_at > now + Duration::hours(4) {
        return Err(RuntimeError::BadRequest(
            "expiry must be within the next four hours".into(),
        ));
    }
    Ok(())
}

fn validate_workspace_id(workspace_id: &str) -> Result<()> {
    if workspace_id_pattern().is_match(workspace_id) {
        Ok(())
    } else {
        Err(RuntimeError::BadRequest("invalid workspace ID".into()))
    }
}

fn validate_terminal_id(session_id: &str) -> Result<()> {
    if terminal_id_pattern().is_match(session_id) {
        Ok(())
    } else {
        Err(RuntimeError::BadRequest(
            "invalid terminal session ID".into(),
        ))
    }
}

fn validate_codex_exec_id(session_id: &str) -> Result<()> {
    if codex_exec_id_pattern().is_match(session_id) {
        Ok(())
    } else {
        Err(RuntimeError::BadRequest(
            "invalid codex exec session ID".into(),
        ))
    }
}

fn validate_optional_worktree_id(worktree_id: Option<&str>) -> Result<()> {
    worktree_id.map_or(Ok(()), validate_worktree_id)
}

fn validate_worktree_id(worktree_id: &str) -> Result<()> {
    if worktree_id_pattern().is_match(worktree_id) {
        Ok(())
    } else {
        Err(RuntimeError::BadRequest("invalid worktree ID".into()))
    }
}

fn validate_sha(value: &str, label: &str) -> Result<()> {
    if commit_sha_pattern().is_match(value) {
        Ok(())
    } else {
        Err(RuntimeError::BadRequest(format!("invalid {label}")))
    }
}

fn workspace_id_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
            .expect("workspace regex")
    })
}

fn commit_sha_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"^[0-9a-f]{40}$").expect("commit regex"))
}

fn terminal_id_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"^term-[0-9]+-[0-9]+$").expect("terminal regex"))
}

fn codex_exec_id_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"^codex-[0-9]+-[0-9]+$").expect("codex exec regex"))
}

fn worktree_id_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$").expect("worktree regex")
    })
}

fn digest_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"^[0-9a-f]{64}$").expect("digest regex"))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use tower::ServiceExt;

    use super::*;
    use crate::backend::{Backend, IdeBackend};
    use crate::model::{
        CreateRequest, RepositorySnapshot, RepositorySnapshotFile, SandboxLifecycleHooks,
        SandboxLifecycleOptions,
    };

    #[test]
    fn validates_credential_free_private_snapshots() {
        let request = CreateRequest {
            workspace_id: "e010bd2c-a3c1-438f-acef-166287a3b1cb".into(),
            repository_url: None,
            repository_snapshot: Some(RepositorySnapshot {
                files: vec![RepositorySnapshotFile {
                    path: "README.md".into(),
                    mode: "100644".into(),
                    content_base64: BASE64.encode(b"# Private"),
                }],
                total_bytes: 9,
            }),
            base_sha: "fc1ba2947ffdaf8c1961e5342387e1079afface6".into(),
            expires_at: Utc::now() + Duration::hours(1),
            resume_from_snapshot: false,
            lifecycle: SandboxLifecycleOptions {
                timeout_ms: 14_400_000,
                lifecycle: SandboxLifecycleHooks {
                    on_timeout: "pause".into(),
                    auto_resume: true,
                },
            },
        };
        assert!(validate_create(&request).is_ok());

        let mut lifecycle_request = request.clone();
        lifecycle_request.lifecycle.lifecycle.auto_resume = false;
        assert!(validate_create(&lifecycle_request).is_err());

        let missing_lifecycle = serde_json::json!({
            "workspaceId": "e010bd2c-a3c1-438f-acef-166287a3b1cb",
            "repositoryUrl": null,
            "repositorySnapshot": {
                "files": [],
                "totalBytes": 0
            },
            "baseSha": "fc1ba2947ffdaf8c1961e5342387e1079afface6",
            "expiresAt": (Utc::now() + Duration::hours(1)).to_rfc3339(),
            "resumeFromSnapshot": false
        });
        assert!(serde_json::from_value::<CreateRequest>(missing_lifecycle).is_err());

        let mut unsafe_request = request;
        unsafe_request
            .repository_snapshot
            .as_mut()
            .expect("snapshot")
            .files[0]
            .path = "../credential".into();
        assert!(validate_create(&unsafe_request).is_err());
    }

    #[tokio::test]
    async fn health_and_lifecycle() {
        let app = router(Arc::new(Backend::fake()), IdeBackend::Disabled);
        let health = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/healthz")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(health.status(), StatusCode::OK);
        let health_body = to_bytes(health.into_body(), 1 << 20)
            .await
            .expect("health body");
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&health_body).expect("health json")["activeSandboxes"],
            0
        );

        let create = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/sandboxes")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "workspaceId": "e010bd2c-a3c1-438f-acef-166287a3b1cb",
                            "repositoryUrl": "https://github.com/yousef20920/CoDev.git",
                            "baseSha": "fc1ba2947ffdaf8c1961e5342387e1079afface6",
                            "expiresAt": (Utc::now() + Duration::hours(1)).to_rfc3339(),
                            "lifecycle": {
                                "timeoutMs": 14400000,
                                "lifecycle": { "onTimeout": "pause", "autoResume": true }
                            }
                        })
                        .to_string(),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(create.status(), StatusCode::CREATED);
        let body = to_bytes(create.into_body(), 1 << 20).await.expect("body");
        let body_text = String::from_utf8_lossy(&body);
        assert!(body_text.contains("sandbox-e010bd2c"));
        assert!(!body_text.to_lowercase().contains("token"));
        assert!(!body_text.to_lowercase().contains("refresh"));

        let resume = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/sandboxes/e010bd2c-a3c1-438f-acef-166287a3b1cb/resume")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(resume.status(), StatusCode::NO_CONTENT);

        let discard_snapshot = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/v1/sandboxes/e010bd2c-a3c1-438f-acef-166287a3b1cb/snapshot")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(discard_snapshot.status(), StatusCode::NO_CONTENT);

        let worktree = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/sandboxes/e010bd2c-a3c1-438f-acef-166287a3b1cb/worktrees")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "worktreeId": "agent-one",
                            "headSha": "fc1ba2947ffdaf8c1961e5342387e1079afface6"
                        })
                        .to_string(),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(worktree.status(), StatusCode::CREATED);

        let checkpoint = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/sandboxes/e010bd2c-a3c1-438f-acef-166287a3b1cb/worktrees/agent-one/checkpoint")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "expectedHeadSha": "fc1ba2947ffdaf8c1961e5342387e1079afface6"
                        })
                        .to_string(),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(checkpoint.status(), StatusCode::OK);

        let review = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/v1/sandboxes/e010bd2c-a3c1-438f-acef-166287a3b1cb/worktrees/agent-one/review?baseSha=fc1ba2947ffdaf8c1961e5342387e1079afface6")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(review.status(), StatusCode::OK);
        let review_body = to_bytes(review.into_body(), 1 << 20).await.expect("body");
        assert!(String::from_utf8_lossy(&review_body).contains("diffDigest"));

        let invalid_merge = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/sandboxes/e010bd2c-a3c1-438f-acef-166287a3b1cb/worktrees/agent-one/merge")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "expectedIntegrationHeadSha": "fc1ba2947ffdaf8c1961e5342387e1079afface6",
                            "expectedWorktreeHeadSha": "fc1ba2947ffdaf8c1961e5342387e1079afface6",
                            "expectedDiffDigest": "bad"
                        })
                        .to_string(),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(invalid_merge.status(), StatusCode::BAD_REQUEST);

        let invalid_worktree = app
            .oneshot(
                Request::builder()
                    .uri(
                        "/v1/sandboxes/e010bd2c-a3c1-438f-acef-166287a3b1cb/git/status?worktreeId=../escape",
                    )
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(invalid_worktree.status(), StatusCode::BAD_REQUEST);
    }
}
