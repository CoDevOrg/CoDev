use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use wait_timeout::ChildExt;

use crate::model::{ExecRequest, ExecResponse, FileResponse, RuntimeError, WriteFileRequest};

const MAX_BODY_BYTES: usize = 2 << 20;
const MAX_OUTPUT_BYTES: usize = 2 << 20;

pub struct GuestResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

impl GuestResponse {
    fn json(status: u16, value: serde_json::Value) -> Self {
        Self {
            status,
            body: serde_json::to_vec(&value).expect("serialize guest response"),
        }
    }

    fn error(status: u16, error: impl std::fmt::Display) -> Self {
        Self::json(status, serde_json::json!({ "error": error.to_string() }))
    }
}

#[derive(Deserialize)]
struct FileRequest {
    path: String,
}

pub struct GuestService {
    workspace_root: PathBuf,
}

impl GuestService {
    pub fn new(workspace_root: impl AsRef<Path>) -> crate::model::Result<Self> {
        let workspace_root = fs::canonicalize(workspace_root).map_err(RuntimeError::internal)?;
        if !workspace_root.is_dir() {
            return Err(RuntimeError::Unavailable(
                "workspace disk is unavailable".into(),
            ));
        }
        Ok(Self { workspace_root })
    }

    pub fn handle(&self, method: &str, path: &str, body: &[u8]) -> GuestResponse {
        if body.len() > MAX_BODY_BYTES {
            return GuestResponse::error(413, "request exceeds the two MiB limit");
        }
        let result = match (method, path) {
            ("GET", "/healthz") => self.health(),
            ("POST", "/v1/files/read") => self.read_file(body),
            ("POST", "/v1/files/write") => self.write_file(body),
            ("POST", "/v1/pty/exec") => self.exec(body),
            ("GET", "/v1/git/status") => self.git(&["status", "--porcelain=v1", "--branch"]),
            ("GET", "/v1/git/diff") => self.git(&["diff", "--no-ext-diff", "--"]),
            _ => return GuestResponse::error(404, "route not found"),
        };
        match result {
            Ok(value) => GuestResponse::json(200, value),
            Err(error) => match error {
                RuntimeError::BadRequest(_) => GuestResponse::error(400, error),
                RuntimeError::RevisionMismatch(_) | RuntimeError::Conflict(_) => {
                    GuestResponse::error(409, error)
                }
                RuntimeError::Timeout(_) => GuestResponse::error(408, error),
                RuntimeError::Unavailable(_) => GuestResponse::error(503, error),
                _ => GuestResponse::error(500, error),
            },
        }
    }

    fn health(&self) -> crate::model::Result<serde_json::Value> {
        if !self.workspace_root.is_dir() {
            return Err(RuntimeError::Unavailable(
                "workspace disk is unavailable".into(),
            ));
        }
        Ok(serde_json::json!({
            "status": "ok",
            "service": "codev-guest"
        }))
    }

    fn read_file(&self, body: &[u8]) -> crate::model::Result<serde_json::Value> {
        let request: FileRequest = decode(body)?;
        let path = self.resolve_existing(&request.path)?;
        let contents = fs::read(path).map_err(RuntimeError::internal)?;
        if contents.len() > MAX_BODY_BYTES {
            return Err(RuntimeError::BadRequest(
                "file exceeds the two MiB limit".into(),
            ));
        }
        let contents = String::from_utf8(contents)
            .map_err(|_| RuntimeError::BadRequest("file is not valid UTF-8".into()))?;
        serde_json::to_value(FileResponse {
            path: request.path,
            revision: revision(contents.as_bytes()),
            contents,
        })
        .map_err(RuntimeError::internal)
    }

    fn write_file(&self, body: &[u8]) -> crate::model::Result<serde_json::Value> {
        let request: WriteFileRequest = decode(body)?;
        if request.contents.len() > MAX_BODY_BYTES {
            return Err(RuntimeError::BadRequest(
                "file exceeds the two MiB limit".into(),
            ));
        }
        let path = self.resolve_for_write(&request.path)?;
        let current = match fs::read(&path) {
            Ok(contents) => revision(&contents),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => "missing".into(),
            Err(error) => return Err(RuntimeError::internal(error)),
        };
        if current != request.expected_revision {
            return Err(RuntimeError::RevisionMismatch(current));
        }
        atomic_write(&path, request.contents.as_bytes())?;
        Ok(serde_json::json!({
            "revision": revision(request.contents.as_bytes())
        }))
    }

    fn exec(&self, body: &[u8]) -> crate::model::Result<serde_json::Value> {
        let request: ExecRequest = decode(body)?;
        if request.command.is_empty() || request.command.len() > 32 {
            return Err(RuntimeError::BadRequest(
                "command must contain between 1 and 32 arguments".into(),
            ));
        }
        let timeout = if request.timeout_seconds == 0 {
            30
        } else {
            request.timeout_seconds
        };
        if timeout > 60 {
            return Err(RuntimeError::BadRequest(
                "command timeout exceeds 60 seconds".into(),
            ));
        }
        let working_directory = if request.working_dir.is_empty() {
            self.workspace_root.clone()
        } else {
            self.resolve_existing(&request.working_dir)?
        };
        if !working_directory.is_dir() {
            return Err(RuntimeError::BadRequest(
                "working directory is not a directory".into(),
            ));
        }

        let pty = native_pty_system()
            .openpty(PtySize {
                rows: request.rows.max(24),
                cols: request.columns.max(80),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(RuntimeError::internal)?;
        let mut command = CommandBuilder::new(&request.command[0]);
        for argument in &request.command[1..] {
            command.arg(argument);
        }
        command.cwd(working_directory);
        command.env("TERM", "xterm-256color");
        let mut child = pty
            .slave
            .spawn_command(command)
            .map_err(RuntimeError::internal)?;
        drop(pty.slave);
        let mut reader = pty
            .master
            .try_clone_reader()
            .map_err(RuntimeError::internal)?;
        let output_thread = thread::spawn(move || {
            let mut output = Vec::new();
            reader
                .by_ref()
                .take((MAX_OUTPUT_BYTES + 1) as u64)
                .read_to_end(&mut output)
                .map(|_| output)
        });

        let deadline = Instant::now() + Duration::from_secs(timeout);
        let status = loop {
            if let Some(status) = child.try_wait().map_err(RuntimeError::internal)? {
                break status;
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                return Err(RuntimeError::Timeout("command timed out".into()));
            }
            thread::sleep(Duration::from_millis(25));
        };
        drop(pty.master);
        let output = output_thread
            .join()
            .map_err(|_| RuntimeError::Internal("PTY output reader panicked".into()))?
            .map_err(RuntimeError::internal)?;
        if output.len() > MAX_OUTPUT_BYTES {
            return Err(RuntimeError::BadRequest(
                "command output exceeds the two MiB limit".into(),
            ));
        }
        let response = ExecResponse {
            output: String::from_utf8_lossy(&output).into_owned(),
            exit_code: status.exit_code() as i32,
        };
        serde_json::to_value(response).map_err(RuntimeError::internal)
    }

    fn git(&self, arguments: &[&str]) -> crate::model::Result<serde_json::Value> {
        let mut child = Command::new("git")
            .arg("-C")
            .arg(&self.workspace_root)
            .args(arguments)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(RuntimeError::internal)?;
        let status = child
            .wait_timeout(Duration::from_secs(30))
            .map_err(RuntimeError::internal)?;
        if status.is_none() {
            let _ = child.kill();
            let _ = child.wait();
            return Err(RuntimeError::Timeout("git command timed out".into()));
        }
        let output = child.wait_with_output().map_err(RuntimeError::internal)?;
        if output.stdout.len() > MAX_OUTPUT_BYTES || output.stderr.len() > MAX_OUTPUT_BYTES {
            return Err(RuntimeError::BadRequest(
                "git output exceeds the two MiB limit".into(),
            ));
        }
        if !output.status.success() {
            return Err(RuntimeError::Conflict(
                String::from_utf8_lossy(&output.stderr).trim().into(),
            ));
        }
        Ok(serde_json::json!({
            "output": String::from_utf8_lossy(&output.stdout)
        }))
    }

    fn resolve_existing(&self, relative: &str) -> crate::model::Result<PathBuf> {
        let candidate = self.clean_join(relative)?;
        let resolved = fs::canonicalize(candidate).map_err(RuntimeError::internal)?;
        if !resolved.starts_with(&self.workspace_root) {
            return Err(RuntimeError::BadRequest(
                "path escapes the workspace".into(),
            ));
        }
        Ok(resolved)
    }

    fn resolve_for_write(&self, relative: &str) -> crate::model::Result<PathBuf> {
        let candidate = self.clean_join(relative)?;
        let parent = candidate
            .parent()
            .ok_or_else(|| RuntimeError::BadRequest("path has no parent".into()))?;
        let parent = fs::canonicalize(parent).map_err(RuntimeError::internal)?;
        if !parent.starts_with(&self.workspace_root) {
            return Err(RuntimeError::BadRequest(
                "path escapes the workspace".into(),
            ));
        }
        let name = candidate
            .file_name()
            .ok_or_else(|| RuntimeError::BadRequest("path has no filename".into()))?;
        Ok(parent.join(name))
    }

    fn clean_join(&self, relative: &str) -> crate::model::Result<PathBuf> {
        let path = Path::new(relative);
        if relative.is_empty()
            || path.is_absolute()
            || path.components().any(|component| {
                matches!(
                    component,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
        {
            return Err(RuntimeError::BadRequest(
                "path must remain inside the workspace".into(),
            ));
        }
        Ok(self.workspace_root.join(path))
    }
}

fn decode<T: serde::de::DeserializeOwned>(body: &[u8]) -> crate::model::Result<T> {
    serde_json::from_slice(body).map_err(|error| RuntimeError::BadRequest(error.to_string()))
}

fn revision(contents: &[u8]) -> String {
    hex::encode(Sha256::digest(contents))
}

fn atomic_write(path: &Path, contents: &[u8]) -> crate::model::Result<()> {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(RuntimeError::internal)?
        .as_nanos();
    let temporary = path.with_extension(format!("codev-{suffix}.tmp"));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(RuntimeError::internal)?;
    file.write_all(contents).map_err(RuntimeError::internal)?;
    file.sync_all().map_err(RuntimeError::internal)?;
    fs::rename(&temporary, path).map_err(RuntimeError::internal)
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn revision_checked_file_lifecycle() {
        let directory = tempdir().expect("tempdir");
        fs::write(directory.path().join("hello.txt"), "hello").expect("seed");
        let service = GuestService::new(directory.path()).expect("service");

        let read = service.handle("POST", "/v1/files/read", br#"{"path":"hello.txt"}"#);
        assert_eq!(read.status, 200);
        let file: FileResponse = serde_json::from_slice(&read.body).expect("file");

        let write = service.handle(
            "POST",
            "/v1/files/write",
            serde_json::to_string(&WriteFileRequest {
                path: "hello.txt".into(),
                contents: "updated".into(),
                expected_revision: file.revision,
            })
            .expect("request")
            .as_bytes(),
        );
        assert_eq!(write.status, 200);
        assert_eq!(
            fs::read_to_string(directory.path().join("hello.txt")).expect("read"),
            "updated"
        );
    }

    #[test]
    fn rejects_workspace_escape() {
        let directory = tempdir().expect("tempdir");
        let service = GuestService::new(directory.path()).expect("service");
        let response = service.handle("POST", "/v1/files/read", br#"{"path":"../outside"}"#);
        assert_eq!(response.status, 400);
    }
}
