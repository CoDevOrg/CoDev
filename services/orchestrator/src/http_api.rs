use std::sync::OnceLock;

use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderValue, Request, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use chrono::{Duration, Utc};
use regex::Regex;
use serde::Deserialize;

use crate::{
    backend::SharedBackend,
    model::{
        CreateRequest, ExecRequest, Result, RuntimeError, TerminalInputRequest,
        TerminalPollRequest, TerminalResizeRequest, TerminalStartRequest, WorktreeCreateRequest,
        WriteFileRequest,
    },
};

const MAX_REQUEST_BYTES: usize = 1 << 20;

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

pub fn router(backend: SharedBackend) -> Router {
    Router::new()
        .route("/healthz", get(health))
        .route("/v1/sandboxes", post(create_sandbox))
        .route(
            "/v1/sandboxes/{workspace_id}",
            get(get_sandbox).delete(destroy_sandbox),
        )
        .route("/v1/sandboxes/{workspace_id}/activity", post(touch_sandbox))
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
        .route("/v1/sandboxes/{workspace_id}/git/status", get(git_status))
        .route("/v1/sandboxes/{workspace_id}/git/diff", get(git_diff))
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .layer(middleware::from_fn(no_store))
        .with_state(backend)
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
        "service": "codev-orchestrator"
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
    if request.timeout_seconds > 60 {
        return Err(RuntimeError::BadRequest(
            "command timeout exceeds 60 seconds".into(),
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

fn validate_create(request: &CreateRequest) -> Result<()> {
    validate_workspace_id(&request.workspace_id)?;
    if !commit_sha_pattern().is_match(&request.base_sha) {
        return Err(RuntimeError::BadRequest("invalid base SHA".into()));
    }
    let repository = request
        .repository_url
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

fn worktree_id_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$").expect("worktree regex")
    })
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
    use crate::backend::Backend;

    #[tokio::test]
    async fn health_and_lifecycle() {
        let app = router(Arc::new(Backend::fake()));
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
                            "expiresAt": (Utc::now() + Duration::hours(1)).to_rfc3339()
                        })
                        .to_string(),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(create.status(), StatusCode::CREATED);
        let body = to_bytes(create.into_body(), 1 << 20).await.expect("body");
        assert!(String::from_utf8_lossy(&body).contains("sandbox-e010bd2c"));

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
