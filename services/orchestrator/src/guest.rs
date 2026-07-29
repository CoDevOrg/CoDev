use std::{
    collections::{HashMap, VecDeque},
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use wait_timeout::ChildExt;

use crate::model::{
    ExecRequest, ExecResponse, FileResponse, RuntimeError, TerminalChunk, TerminalInputRequest,
    TerminalPollRequest, TerminalPollResponse, TerminalResizeRequest, TerminalStartRequest,
    WorktreeCreateRequest, WriteFileRequest,
};

const MAX_BODY_BYTES: usize = 2 << 20;
const MAX_OUTPUT_BYTES: usize = 2 << 20;
const MAX_TERMINAL_BUFFER_BYTES: usize = 1 << 20;
const MAX_TERMINAL_INPUT_BYTES: usize = 64 << 10;
static TERMINAL_SEQUENCE: AtomicU64 = AtomicU64::new(1);

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
    #[serde(default, rename = "worktreeId")]
    worktree_id: Option<String>,
}

pub struct GuestService {
    workspace_root: PathBuf,
    terminals: Mutex<HashMap<String, Arc<TerminalSession>>>,
}

impl GuestService {
    pub fn new(workspace_root: impl AsRef<Path>) -> crate::model::Result<Self> {
        let workspace_root = fs::canonicalize(workspace_root).map_err(RuntimeError::internal)?;
        if !workspace_root.is_dir() {
            return Err(RuntimeError::Unavailable(
                "workspace disk is unavailable".into(),
            ));
        }
        Ok(Self {
            workspace_root,
            terminals: Mutex::new(HashMap::new()),
        })
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
            ("POST", "/v1/terminals") => self.start_terminal(body),
            ("POST", "/v1/worktrees") => self.create_worktree(body),
            _ => {
                if let Some(worktree_id) = path.strip_prefix("/v1/worktrees/") {
                    match method {
                        "DELETE" => self.delete_worktree(worktree_id),
                        _ => Err(RuntimeError::BadRequest("invalid worktree action".into())),
                    }
                } else if let Some((git_path, worktree_id)) = git_route(path) {
                    self.target_root(worktree_id)
                        .and_then(|root| match git_path {
                            "status" => self.git(&root, &["status", "--porcelain=v1", "--branch"]),
                            "diff" => self.git(&root, &["diff", "--no-ext-diff", "--"]),
                            _ => Err(RuntimeError::BadRequest("invalid Git action".into())),
                        })
                } else if let Some((session_id, action)) = terminal_route(path) {
                    match (method, action) {
                        ("POST", "input") => self.input_terminal(session_id, body),
                        ("POST", "resize") => self.resize_terminal(session_id, body),
                        ("POST", "poll") => self.poll_terminal(session_id, body),
                        ("DELETE", "") => self.close_terminal(session_id),
                        _ => Err(RuntimeError::BadRequest("invalid terminal action".into())),
                    }
                } else {
                    return GuestResponse::error(404, "route not found");
                }
            }
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
        let root = self.target_root(request.worktree_id.as_deref())?;
        let path = self.resolve_existing(&root, &request.path)?;
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
        let root = self.target_root(request.worktree_id.as_deref())?;
        let path = self.resolve_for_write(&root, &request.path)?;
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
        let root = self.target_root(request.worktree_id.as_deref())?;
        let working_directory = if request.working_dir.is_empty() {
            root.clone()
        } else {
            self.resolve_existing(&root, &request.working_dir)?
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

    fn start_terminal(&self, body: &[u8]) -> crate::model::Result<serde_json::Value> {
        let request: TerminalStartRequest = decode(body)?;
        let size = validated_terminal_size(request.rows, request.columns)?;
        let pty = native_pty_system()
            .openpty(size)
            .map_err(RuntimeError::internal)?;
        let mut command = CommandBuilder::new("/bin/sh");
        command.arg("-l");
        command.cwd(&self.workspace_root);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        let mut child = pty
            .slave
            .spawn_command(command)
            .map_err(RuntimeError::internal)?;
        drop(pty.slave);
        let mut reader = pty
            .master
            .try_clone_reader()
            .map_err(RuntimeError::internal)?;
        let writer = pty.master.take_writer().map_err(RuntimeError::internal)?;
        let session_id = format!(
            "term-{}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(RuntimeError::internal)?
                .as_millis(),
            TERMINAL_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let session = Arc::new(TerminalSession {
            master: Mutex::new(pty.master),
            writer: Mutex::new(writer),
            output: Mutex::new(TerminalOutput::default()),
            output_changed: Condvar::new(),
        });
        self.terminals
            .lock()
            .expect("terminal map lock")
            .insert(session_id.clone(), session.clone());

        let reader_session = session.clone();
        thread::spawn(move || {
            let mut buffer = [0_u8; 8 << 10];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => {
                        let mut output =
                            reader_session.output.lock().expect("terminal output lock");
                        output.reader_closed = true;
                        reader_session.output_changed.notify_all();
                        break;
                    }
                    Ok(length) => {
                        let data = String::from_utf8_lossy(&buffer[..length]).into_owned();
                        let bytes = data.len();
                        let mut output =
                            reader_session.output.lock().expect("terminal output lock");
                        while output.buffered_bytes >= MAX_TERMINAL_BUFFER_BYTES
                            && !output.reader_closed
                        {
                            output = reader_session
                                .output_changed
                                .wait(output)
                                .expect("terminal output lock");
                        }
                        let sequence = output.next_sequence;
                        output.next_sequence += 1;
                        output.buffered_bytes += bytes;
                        output.chunks.push_back(TerminalChunk { sequence, data });
                        reader_session.output_changed.notify_all();
                    }
                }
            }
        });

        let child_session = session;
        thread::spawn(move || {
            let exit_code = child
                .wait()
                .map(|status| status.exit_code() as i32)
                .unwrap_or(1);
            let mut output = child_session.output.lock().expect("terminal output lock");
            output.exit_code = Some(exit_code);
            child_session.output_changed.notify_all();
        });

        Ok(serde_json::json!({ "sessionId": session_id }))
    }

    fn input_terminal(
        &self,
        session_id: &str,
        body: &[u8],
    ) -> crate::model::Result<serde_json::Value> {
        let request: TerminalInputRequest = decode(body)?;
        if request.data.len() > MAX_TERMINAL_INPUT_BYTES {
            return Err(RuntimeError::BadRequest(
                "terminal input exceeds 64 KiB".into(),
            ));
        }
        let session = self.terminal(session_id)?;
        let mut writer = session.writer.lock().expect("terminal writer lock");
        writer
            .write_all(request.data.as_bytes())
            .and_then(|_| writer.flush())
            .map_err(RuntimeError::internal)?;
        Ok(serde_json::json!({ "accepted": request.data.len() }))
    }

    fn resize_terminal(
        &self,
        session_id: &str,
        body: &[u8],
    ) -> crate::model::Result<serde_json::Value> {
        let request: TerminalResizeRequest = decode(body)?;
        let size = validated_terminal_size(request.rows, request.columns)?;
        self.terminal(session_id)?
            .master
            .lock()
            .expect("terminal master lock")
            .resize(size)
            .map_err(RuntimeError::internal)?;
        Ok(serde_json::json!({ "resized": true }))
    }

    fn poll_terminal(
        &self,
        session_id: &str,
        body: &[u8],
    ) -> crate::model::Result<serde_json::Value> {
        let request: TerminalPollRequest = decode(body)?;
        let session = self.terminal(session_id)?;
        let mut output = session.output.lock().expect("terminal output lock");
        while output
            .chunks
            .front()
            .is_some_and(|chunk| chunk.sequence <= request.after)
        {
            if let Some(chunk) = output.chunks.pop_front() {
                output.buffered_bytes = output.buffered_bytes.saturating_sub(chunk.data.len());
            }
        }
        session.output_changed.notify_all();
        if output.chunks.is_empty()
            && !(output.reader_closed && output.exit_code.is_some())
            && request.wait_milliseconds > 0
        {
            let wait = Duration::from_millis(request.wait_milliseconds.min(25_000));
            let (next_output, _) = session
                .output_changed
                .wait_timeout(output, wait)
                .expect("terminal output lock");
            output = next_output;
        }
        let response = TerminalPollResponse {
            chunks: output.chunks.iter().take(128).cloned().collect(),
            next_sequence: output.next_sequence,
            exited: output.reader_closed && output.exit_code.is_some(),
            exit_code: output.exit_code,
        };
        serde_json::to_value(response).map_err(RuntimeError::internal)
    }

    fn close_terminal(&self, session_id: &str) -> crate::model::Result<serde_json::Value> {
        let session = self
            .terminals
            .lock()
            .expect("terminal map lock")
            .remove(session_id)
            .ok_or_else(|| RuntimeError::BadRequest("terminal session not found".into()))?;
        let mut writer = session.writer.lock().expect("terminal writer lock");
        let _ = writer.write_all(b"\x03exit\n");
        let _ = writer.flush();
        let mut output = session.output.lock().expect("terminal output lock");
        output.reader_closed = true;
        session.output_changed.notify_all();
        Ok(serde_json::json!({ "closed": true }))
    }

    fn terminal(&self, session_id: &str) -> crate::model::Result<Arc<TerminalSession>> {
        self.terminals
            .lock()
            .expect("terminal map lock")
            .get(session_id)
            .cloned()
            .ok_or_else(|| RuntimeError::BadRequest("terminal session not found".into()))
    }

    fn create_worktree(&self, body: &[u8]) -> crate::model::Result<serde_json::Value> {
        let request: WorktreeCreateRequest = decode(body)?;
        validate_worktree_id(&request.worktree_id)?;
        validate_commit_sha(&request.head_sha)?;
        let worktrees_root = self.worktrees_root()?;
        fs::create_dir_all(&worktrees_root).map_err(RuntimeError::internal)?;
        let target = worktrees_root.join(&request.worktree_id);
        if target.exists() {
            return Err(RuntimeError::Conflict("worktree already exists".into()));
        }
        self.git(
            &self.workspace_root,
            &[
                "worktree",
                "add",
                "--detach",
                target
                    .to_str()
                    .ok_or_else(|| RuntimeError::Internal("invalid worktree path".into()))?,
                &request.head_sha,
            ],
        )?;
        Ok(serde_json::json!({
            "worktreeId": request.worktree_id,
            "headSha": request.head_sha
        }))
    }

    fn delete_worktree(&self, worktree_id: &str) -> crate::model::Result<serde_json::Value> {
        validate_worktree_id(worktree_id)?;
        let target = self.worktrees_root()?.join(worktree_id);
        if !target.is_dir() {
            return Err(RuntimeError::BadRequest("worktree not found".into()));
        }
        let target = fs::canonicalize(target).map_err(RuntimeError::internal)?;
        let root = self.worktrees_root()?;
        if !target.starts_with(&root) {
            return Err(RuntimeError::BadRequest(
                "worktree path escapes the workspace".into(),
            ));
        }
        self.git(
            &self.workspace_root,
            &[
                "worktree",
                "remove",
                "--force",
                target
                    .to_str()
                    .ok_or_else(|| RuntimeError::Internal("invalid worktree path".into()))?,
            ],
        )?;
        self.git(&self.workspace_root, &["worktree", "prune"])?;
        Ok(serde_json::json!({ "deleted": true }))
    }

    fn git(&self, root: &Path, arguments: &[&str]) -> crate::model::Result<serde_json::Value> {
        let mut child = Command::new("git")
            .arg("-C")
            .arg(root)
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

    fn target_root(&self, worktree_id: Option<&str>) -> crate::model::Result<PathBuf> {
        let Some(worktree_id) = worktree_id else {
            return Ok(self.workspace_root.clone());
        };
        validate_worktree_id(worktree_id)?;
        let worktrees_root = self.worktrees_root()?;
        let resolved = fs::canonicalize(worktrees_root.join(worktree_id)).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                RuntimeError::BadRequest("worktree not found".into())
            } else {
                RuntimeError::internal(error)
            }
        })?;
        if !resolved.is_dir() || !resolved.starts_with(&worktrees_root) {
            return Err(RuntimeError::BadRequest(
                "worktree path escapes the workspace".into(),
            ));
        }
        Ok(resolved)
    }

    fn worktrees_root(&self) -> crate::model::Result<PathBuf> {
        let git_directory = fs::canonicalize(self.workspace_root.join(".git")).map_err(|_| {
            RuntimeError::Unavailable("workspace Git repository is unavailable".into())
        })?;
        if !git_directory.starts_with(&self.workspace_root) {
            return Err(RuntimeError::BadRequest(
                "Git directory escapes the workspace".into(),
            ));
        }
        Ok(git_directory.join("codev-agent-worktrees"))
    }

    fn resolve_existing(&self, root: &Path, relative: &str) -> crate::model::Result<PathBuf> {
        let candidate = self.clean_join(root, relative)?;
        let resolved = fs::canonicalize(candidate).map_err(RuntimeError::internal)?;
        if !resolved.starts_with(root) {
            return Err(RuntimeError::BadRequest(
                "path escapes the workspace".into(),
            ));
        }
        Ok(resolved)
    }

    fn resolve_for_write(&self, root: &Path, relative: &str) -> crate::model::Result<PathBuf> {
        let candidate = self.clean_join(root, relative)?;
        let parent = candidate
            .parent()
            .ok_or_else(|| RuntimeError::BadRequest("path has no parent".into()))?;
        let parent = fs::canonicalize(parent).map_err(RuntimeError::internal)?;
        if !parent.starts_with(root) {
            return Err(RuntimeError::BadRequest(
                "path escapes the workspace".into(),
            ));
        }
        let name = candidate
            .file_name()
            .ok_or_else(|| RuntimeError::BadRequest("path has no filename".into()))?;
        Ok(parent.join(name))
    }

    fn clean_join(&self, root: &Path, relative: &str) -> crate::model::Result<PathBuf> {
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
        Ok(root.join(path))
    }
}

struct TerminalSession {
    master: Mutex<Box<dyn portable_pty::MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    output: Mutex<TerminalOutput>,
    output_changed: Condvar,
}

struct TerminalOutput {
    chunks: VecDeque<TerminalChunk>,
    buffered_bytes: usize,
    next_sequence: u64,
    reader_closed: bool,
    exit_code: Option<i32>,
}

impl Default for TerminalOutput {
    fn default() -> Self {
        Self {
            chunks: VecDeque::new(),
            buffered_bytes: 0,
            next_sequence: 1,
            reader_closed: false,
            exit_code: None,
        }
    }
}

fn terminal_route(path: &str) -> Option<(&str, &str)> {
    let suffix = path.strip_prefix("/v1/terminals/")?;
    let (session_id, action) = suffix.split_once('/').unwrap_or((suffix, ""));
    (!session_id.is_empty()).then_some((session_id, action))
}

fn git_route(path: &str) -> Option<(&str, Option<&str>)> {
    let suffix = path.strip_prefix("/v1/git/")?;
    let (action, query) = suffix.split_once('?').unwrap_or((suffix, ""));
    let worktree_id = query
        .split('&')
        .find_map(|part| part.strip_prefix("worktreeId="))
        .filter(|value| !value.is_empty());
    Some((action, worktree_id))
}

fn validate_worktree_id(worktree_id: &str) -> crate::model::Result<()> {
    let valid = !worktree_id.is_empty()
        && worktree_id.len() <= 64
        && worktree_id.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || (byte == b'-' && index > 0)
        })
        && !worktree_id.ends_with('-');
    if valid {
        Ok(())
    } else {
        Err(RuntimeError::BadRequest("invalid worktree ID".into()))
    }
}

fn validate_commit_sha(head_sha: &str) -> crate::model::Result<()> {
    if head_sha.len() == 40 && head_sha.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(RuntimeError::BadRequest("invalid worktree head SHA".into()))
    }
}

fn validated_terminal_size(rows: u16, columns: u16) -> crate::model::Result<PtySize> {
    let rows = if rows == 0 { 24 } else { rows };
    let cols = if columns == 0 { 80 } else { columns };
    if rows > 500 || cols > 500 {
        return Err(RuntimeError::BadRequest(
            "terminal dimensions exceed 500 cells".into(),
        ));
    }
    Ok(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
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
    use std::process::Command;

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
                worktree_id: None,
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

    #[test]
    fn agent_worktree_lifecycle_and_scoped_operations() {
        let directory = tempdir().expect("tempdir");
        git(directory.path(), &["init", "--quiet"]);
        git(
            directory.path(),
            &["config", "user.email", "codev@example.com"],
        );
        git(directory.path(), &["config", "user.name", "CoDev Test"]);
        fs::write(directory.path().join("hello.txt"), "integration").expect("seed");
        git(directory.path(), &["add", "hello.txt"]);
        git(directory.path(), &["commit", "--quiet", "-m", "seed"]);
        let head_sha = String::from_utf8(
            Command::new("git")
                .arg("-C")
                .arg(directory.path())
                .args(["rev-parse", "HEAD"])
                .output()
                .expect("rev-parse")
                .stdout,
        )
        .expect("sha")
        .trim()
        .to_owned();
        let service = GuestService::new(directory.path()).expect("service");

        let create = service.handle(
            "POST",
            "/v1/worktrees",
            serde_json::to_string(&WorktreeCreateRequest {
                worktree_id: "agent-one".into(),
                head_sha,
            })
            .expect("request")
            .as_bytes(),
        );
        assert_eq!(
            create.status,
            200,
            "{}",
            String::from_utf8_lossy(&create.body)
        );

        let read = service.handle(
            "POST",
            "/v1/files/read",
            br#"{"path":"hello.txt","worktreeId":"agent-one"}"#,
        );
        assert_eq!(read.status, 200);
        let file: FileResponse = serde_json::from_slice(&read.body).expect("file");
        assert_eq!(file.contents, "integration");

        let write = service.handle(
            "POST",
            "/v1/files/write",
            serde_json::to_string(&WriteFileRequest {
                path: "hello.txt".into(),
                contents: "agent edit".into(),
                expected_revision: file.revision,
                worktree_id: Some("agent-one".into()),
            })
            .expect("request")
            .as_bytes(),
        );
        assert_eq!(write.status, 200);
        assert_eq!(
            fs::read_to_string(directory.path().join("hello.txt")).expect("integration read"),
            "integration"
        );

        let status = service.handle("GET", "/v1/git/status?worktreeId=agent-one", b"");
        assert_eq!(status.status, 200);
        assert!(String::from_utf8_lossy(&status.body).contains("hello.txt"));
        let diff = service.handle("GET", "/v1/git/diff?worktreeId=agent-one", b"");
        assert_eq!(diff.status, 200);
        assert!(String::from_utf8_lossy(&diff.body).contains("agent edit"));

        let exec = service.handle(
            "POST",
            "/v1/pty/exec",
            br#"{"command":["pwd"],"worktreeId":"agent-one"}"#,
        );
        assert_eq!(exec.status, 200);
        let exec: ExecResponse = serde_json::from_slice(&exec.body).expect("exec");
        assert!(exec.output.contains("codev-agent-worktrees/agent-one"));

        let invalid = service.handle("GET", "/v1/git/status?worktreeId=../integration", b"");
        assert_eq!(invalid.status, 400);

        let delete = service.handle("DELETE", "/v1/worktrees/agent-one", b"");
        assert_eq!(
            delete.status,
            200,
            "{}",
            String::from_utf8_lossy(&delete.body)
        );
        let missing = service.handle("GET", "/v1/git/status?worktreeId=agent-one", b"");
        assert_eq!(missing.status, 400);
    }

    #[test]
    fn terminal_streams_sequenced_output() {
        let directory = tempdir().expect("tempdir");
        let service = GuestService::new(directory.path()).expect("service");
        let start = service.handle("POST", "/v1/terminals", br#"{"rows":24,"columns":80}"#);
        assert_eq!(start.status, 200);
        let start_body: serde_json::Value =
            serde_json::from_slice(&start.body).expect("terminal start");
        let session_id = start_body["sessionId"].as_str().expect("session id");

        let input = service.handle(
            "POST",
            &format!("/v1/terminals/{session_id}/input"),
            br#"{"data":"printf 'codev-terminal-ok\\n'\n"}"#,
        );
        assert_eq!(input.status, 200);
        let poll = service.handle(
            "POST",
            &format!("/v1/terminals/{session_id}/poll"),
            br#"{"after":0,"waitMilliseconds":2000}"#,
        );
        assert_eq!(poll.status, 200);
        let result: TerminalPollResponse =
            serde_json::from_slice(&poll.body).expect("terminal poll");
        assert!(
            result
                .chunks
                .iter()
                .any(|chunk| chunk.data.contains("codev-terminal-ok"))
        );
        assert!(result.chunks.iter().all(|chunk| chunk.sequence > 0));

        let close = service.handle("DELETE", &format!("/v1/terminals/{session_id}"), b"");
        assert_eq!(close.status, 200);
    }

    fn git(root: &Path, arguments: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(arguments)
            .output()
            .expect("git");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
