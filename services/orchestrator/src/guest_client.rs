use std::path::{Path, PathBuf};

use serde::{Serialize, de::DeserializeOwned};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::UnixStream,
    time::{Duration, timeout},
};

use crate::model::{
    ExecRequest, ExecResponse, FileResponse, PublicationExportRequest, PublicationExportResponse,
    Result, RuntimeError, TerminalInputRequest, TerminalPollRequest, TerminalPollResponse,
    TerminalResizeRequest, TerminalStartRequest, WorktreeCheckpointRequest,
    WorktreeCheckpointResponse, WorktreeCreateRequest, WorktreeMergeRequest, WorktreeMergeResponse,
    WorktreeRebaseRequest, WorktreeRebaseResponse, WorktreeReviewResponse, WriteFileRequest,
};

const MAX_RESPONSE_BYTES: usize = 10 << 20;

pub struct GuestClient {
    socket_path: PathBuf,
    port: u32,
}

impl GuestClient {
    pub fn new(socket_path: impl AsRef<Path>, port: u32) -> Self {
        Self {
            socket_path: socket_path.as_ref().into(),
            port,
        }
    }

    pub async fn health(&self) -> Result<()> {
        self.request::<(), serde_json::Value>("GET", "/healthz", None)
            .await
            .map(|_| ())
    }

    pub async fn read_file(&self, path: String, worktree_id: Option<&str>) -> Result<FileResponse> {
        self.request(
            "POST",
            "/v1/files/read",
            Some(&serde_json::json!({ "path": path, "worktreeId": worktree_id })),
        )
        .await
    }

    pub async fn write_file(&self, request: &WriteFileRequest) -> Result<String> {
        let response: serde_json::Value = self
            .request("POST", "/v1/files/write", Some(request))
            .await?;
        response
            .get("revision")
            .and_then(|value| value.as_str())
            .map(str::to_owned)
            .ok_or_else(|| RuntimeError::GuestUnavailable("missing revision".into()))
    }

    pub async fn exec(&self, request: &ExecRequest) -> Result<ExecResponse> {
        self.request("POST", "/v1/pty/exec", Some(request)).await
    }

    pub async fn start_terminal(&self, request: &TerminalStartRequest) -> Result<String> {
        let response: serde_json::Value =
            self.request("POST", "/v1/terminals", Some(request)).await?;
        response
            .get("sessionId")
            .and_then(|value| value.as_str())
            .map(str::to_owned)
            .ok_or_else(|| RuntimeError::GuestUnavailable("missing terminal session ID".into()))
    }

    pub async fn input_terminal(
        &self,
        session_id: &str,
        request: &TerminalInputRequest,
    ) -> Result<()> {
        self.request::<_, serde_json::Value>(
            "POST",
            &format!("/v1/terminals/{session_id}/input"),
            Some(request),
        )
        .await
        .map(|_| ())
    }

    pub async fn resize_terminal(
        &self,
        session_id: &str,
        request: &TerminalResizeRequest,
    ) -> Result<()> {
        self.request::<_, serde_json::Value>(
            "POST",
            &format!("/v1/terminals/{session_id}/resize"),
            Some(request),
        )
        .await
        .map(|_| ())
    }

    pub async fn poll_terminal(
        &self,
        session_id: &str,
        request: &TerminalPollRequest,
    ) -> Result<TerminalPollResponse> {
        self.request(
            "POST",
            &format!("/v1/terminals/{session_id}/poll"),
            Some(request),
        )
        .await
    }

    pub async fn close_terminal(&self, session_id: &str) -> Result<()> {
        self.request::<(), serde_json::Value>(
            "DELETE",
            &format!("/v1/terminals/{session_id}"),
            None,
        )
        .await
        .map(|_| ())
    }

    pub async fn create_worktree(&self, request: &WorktreeCreateRequest) -> Result<()> {
        self.request::<_, serde_json::Value>("POST", "/v1/worktrees", Some(request))
            .await
            .map(|_| ())
    }

    pub async fn delete_worktree(&self, worktree_id: &str) -> Result<()> {
        self.request::<(), serde_json::Value>(
            "DELETE",
            &format!("/v1/worktrees/{worktree_id}"),
            None,
        )
        .await
        .map(|_| ())
    }

    pub async fn checkpoint_worktree(
        &self,
        worktree_id: &str,
        request: &WorktreeCheckpointRequest,
    ) -> Result<WorktreeCheckpointResponse> {
        self.request(
            "POST",
            &format!("/v1/worktrees/{worktree_id}/checkpoint"),
            Some(request),
        )
        .await
    }

    pub async fn review_worktree(
        &self,
        worktree_id: &str,
        base_sha: &str,
    ) -> Result<WorktreeReviewResponse> {
        self.request::<(), _>(
            "GET",
            &format!("/v1/worktrees/{worktree_id}/review?baseSha={base_sha}"),
            None,
        )
        .await
    }

    pub async fn rebase_worktree(
        &self,
        worktree_id: &str,
        request: &WorktreeRebaseRequest,
    ) -> Result<WorktreeRebaseResponse> {
        self.request(
            "POST",
            &format!("/v1/worktrees/{worktree_id}/rebase"),
            Some(request),
        )
        .await
    }

    pub async fn merge_worktree(
        &self,
        worktree_id: &str,
        request: &WorktreeMergeRequest,
    ) -> Result<WorktreeMergeResponse> {
        self.request(
            "POST",
            &format!("/v1/worktrees/{worktree_id}/merge"),
            Some(request),
        )
        .await
    }

    pub async fn export_publication(
        &self,
        request: &PublicationExportRequest,
    ) -> Result<PublicationExportResponse> {
        self.request("POST", "/v1/publication/export", Some(request))
            .await
    }

    pub async fn snapshot_workspace(
        &self,
        request: &PublicationExportRequest,
    ) -> Result<PublicationExportResponse> {
        self.request("POST", "/v1/workspace/snapshot", Some(request))
            .await
    }

    pub async fn git_status(&self, worktree_id: Option<&str>) -> Result<String> {
        self.git(&git_path("status", worktree_id)).await
    }

    pub async fn git_diff(&self, worktree_id: Option<&str>) -> Result<String> {
        self.git(&git_path("diff", worktree_id)).await
    }

    async fn git(&self, path: &str) -> Result<String> {
        let response: serde_json::Value = self.request::<(), _>("GET", path, None).await?;
        response
            .get("output")
            .and_then(|value| value.as_str())
            .map(str::to_owned)
            .ok_or_else(|| RuntimeError::GuestUnavailable("missing Git output".into()))
    }

    async fn request<B: Serialize + ?Sized, T: DeserializeOwned>(
        &self,
        method: &str,
        path: &str,
        body: Option<&B>,
    ) -> Result<T> {
        timeout(Duration::from_secs(65), async {
            let mut stream = UnixStream::connect(&self.socket_path)
                .await
                .map_err(|error| RuntimeError::GuestUnavailable(error.to_string()))?;
            stream
                .write_all(format!("CONNECT {}\n", self.port).as_bytes())
                .await
                .map_err(|error| RuntimeError::GuestUnavailable(error.to_string()))?;
            let line = read_until(&mut stream, b'\n', 256).await?;
            if !line.starts_with(b"OK ") {
                return Err(RuntimeError::GuestUnavailable(
                    String::from_utf8_lossy(&line).trim().into(),
                ));
            }

            let body = body
                .map(serde_json::to_vec)
                .transpose()
                .map_err(|error| RuntimeError::GuestUnavailable(error.to_string()))?
                .unwrap_or_default();
            let request = format!(
                "{method} {path} HTTP/1.1\r\nHost: guest\r\nAccept: application/json\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream
                .write_all(request.as_bytes())
                .await
                .map_err(|error| RuntimeError::GuestUnavailable(error.to_string()))?;
            stream
                .write_all(&body)
                .await
                .map_err(|error| RuntimeError::GuestUnavailable(error.to_string()))?;

            let headers = read_until_sequence(&mut stream, b"\r\n\r\n", 64 << 10).await?;
            let header_text = String::from_utf8_lossy(&headers);
            let status = header_text
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .and_then(|value| value.parse::<u16>().ok())
                .ok_or_else(|| RuntimeError::GuestUnavailable("invalid HTTP response".into()))?;
            let content_length = header_text
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().ok())
                        .flatten()
                })
                .ok_or_else(|| RuntimeError::GuestUnavailable("missing content length".into()))?;
            if content_length > MAX_RESPONSE_BYTES {
                return Err(RuntimeError::GuestUnavailable(
                    "guest response is too large".into(),
                ));
            }
            let mut response_body = vec![0; content_length];
            stream
                .read_exact(&mut response_body)
                .await
                .map_err(|error| RuntimeError::GuestUnavailable(error.to_string()))?;
            if !(200..300).contains(&status) {
                let payload = serde_json::from_slice::<serde_json::Value>(&response_body).ok();
                let message = payload
                    .as_ref()
                    .and_then(|value| value.get("error")?.as_str().map(str::to_owned))
                    .unwrap_or_else(|| format!("guest daemon returned HTTP {status}"));
                return Err(match status {
                    409 => {
                        if message.contains("capacity exceeded") {
                            RuntimeError::CapacityExceeded
                        } else {
                            let conflict_paths = payload
                                .as_ref()
                                .and_then(|value| value.get("conflictPaths"))
                                .and_then(|value| value.as_array())
                                .map(|paths| {
                                    paths
                                        .iter()
                                        .filter_map(|path| path.as_str().map(str::to_owned))
                                        .collect::<Vec<_>>()
                                })
                                .unwrap_or_default();
                            if conflict_paths.is_empty() {
                                RuntimeError::Conflict(message)
                            } else {
                                RuntimeError::GitConflict {
                                    message,
                                    conflict_paths,
                                }
                            }
                        }
                    }
                    408 => RuntimeError::Timeout(message),
                    _ if message.contains("capacity exceeded") => RuntimeError::CapacityExceeded,
                    _ => RuntimeError::GuestUnavailable(message),
                });
            }
            serde_json::from_slice(&response_body)
                .map_err(|error| RuntimeError::GuestUnavailable(error.to_string()))
        })
        .await
        .map_err(|_| RuntimeError::GuestUnavailable("guest request timed out".into()))?
    }
}

fn git_path(action: &str, worktree_id: Option<&str>) -> String {
    match worktree_id {
        Some(worktree_id) => format!("/v1/git/{action}?worktreeId={worktree_id}"),
        None => format!("/v1/git/{action}"),
    }
}

async fn read_until(stream: &mut UnixStream, byte: u8, limit: usize) -> Result<Vec<u8>> {
    let mut output = Vec::new();
    while output.len() < limit {
        let value = stream
            .read_u8()
            .await
            .map_err(|error| RuntimeError::GuestUnavailable(error.to_string()))?;
        output.push(value);
        if value == byte {
            return Ok(output);
        }
    }
    Err(RuntimeError::GuestUnavailable(
        "guest handshake exceeded limit".into(),
    ))
}

async fn read_until_sequence(
    stream: &mut UnixStream,
    sequence: &[u8],
    limit: usize,
) -> Result<Vec<u8>> {
    let mut output = Vec::new();
    while output.len() < limit {
        output.push(
            stream
                .read_u8()
                .await
                .map_err(|error| RuntimeError::GuestUnavailable(error.to_string()))?,
        );
        if output.ends_with(sequence) {
            return Ok(output);
        }
    }
    Err(RuntimeError::GuestUnavailable(
        "guest HTTP headers exceeded limit".into(),
    ))
}
