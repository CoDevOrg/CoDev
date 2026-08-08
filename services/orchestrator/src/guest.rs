use std::{
    collections::{HashMap, VecDeque},
    fs::{self, OpenOptions},
    io::{Read, Write},
    os::unix::fs::PermissionsExt,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use wait_timeout::ChildExt;

use crate::model::{
    ExecRequest, ExecResponse, FileResponse, PublicationExportRequest, PublicationExportResponse,
    PublicationFile, RuntimeError, TerminalChunk, TerminalInputRequest, TerminalPollRequest,
    TerminalPollResponse, TerminalResizeRequest, TerminalStartRequest, WorktreeCheckpointRequest,
    WorktreeCheckpointResponse, WorktreeCreateRequest, WorktreeMergeRequest, WorktreeMergeResponse,
    WorktreeRebaseRequest, WorktreeRebaseResponse, WorktreeReviewResponse, WriteFileRequest,
};

const MAX_BODY_BYTES: usize = 2 << 20;
const MAX_OUTPUT_BYTES: usize = 2 << 20;
const MAX_TERMINAL_BUFFER_BYTES: usize = 1 << 20;
const MAX_TERMINAL_INPUT_BYTES: usize = 64 << 10;
/// Soft cap on concurrent PTYs per guest. New starts always reclaim older
/// sessions instead of failing with capacity exceeded.
const MAX_LIVE_TERMINALS: usize = 4;
const GUEST_PATH: &str = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeReviewQuery {
    base_sha: String,
}

pub struct GuestService {
    workspace_root: PathBuf,
    terminals: Mutex<HashMap<String, Arc<TerminalSession>>>,
    mutations: Mutex<()>,
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
            mutations: Mutex::new(()),
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
            ("POST", "/v1/publication/export") => self.export_publication(body),
            ("POST", "/v1/workspace/snapshot") => self.snapshot_workspace(body),
            _ => {
                if let Some(worktree_id) = path.strip_prefix("/v1/worktrees/") {
                    let (worktree_id, action_and_query) =
                        worktree_id.split_once('/').unwrap_or((worktree_id, ""));
                    let (action, query) = action_and_query
                        .split_once('?')
                        .unwrap_or((action_and_query, ""));
                    match (method, action) {
                        ("DELETE", "") => self.delete_worktree(worktree_id),
                        ("POST", "checkpoint") => self.checkpoint_worktree(worktree_id, body),
                        ("GET", "review") => self.review_worktree(worktree_id, query),
                        ("POST", "rebase") => self.rebase_worktree(worktree_id, body),
                        ("POST", "merge") => self.merge_worktree(worktree_id, body),
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
                RuntimeError::RevisionMismatch(_)
                | RuntimeError::Conflict(_)
                | RuntimeError::CapacityExceeded => GuestResponse::error(409, error),
                RuntimeError::GitConflict {
                    message,
                    conflict_paths,
                } => GuestResponse::json(
                    409,
                    serde_json::json!({
                        "error": message,
                        "conflictPaths": conflict_paths
                    }),
                ),
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
        let metadata = fs::metadata(&path).map_err(RuntimeError::internal)?;
        if metadata.len() > MAX_BODY_BYTES as u64 {
            return Err(RuntimeError::BadRequest(
                "file exceeds the two MiB limit".into(),
            ));
        }
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
        let _mutation = self.mutations.lock().expect("mutation lock");
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
        let _mutation = self.mutations.lock().expect("mutation lock");
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
        command.env("PATH", GUEST_PATH);
        command.env("TERM", "xterm-256color");
        let mut child = match pty.slave.spawn_command(command) {
            Ok(child) => child,
            Err(error) => {
                return serde_json::to_value(ExecResponse {
                    output: format!("Unable to spawn {}: {}\n", request.command[0], error),
                    exit_code: 127,
                })
                .map_err(RuntimeError::internal);
            }
        };
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
        let _mutation = self.mutations.lock().expect("mutation lock");
        {
            let mut terminals = self.terminals.lock().expect("terminal map lock");
            // Drop fully exited sessions first.
            terminals.retain(|_, session| {
                let output = session.output.lock().expect("terminal output lock");
                !(output.reader_closed && output.exit_code.is_some())
            });
            // Always make room for a new PTY — never reject with capacity exceeded.
            while terminals.len() >= MAX_LIVE_TERMINALS {
                let reclaim_id = terminals
                    .iter()
                    .find(|(_, session)| {
                        let output = session.output.lock().expect("terminal output lock");
                        output.reader_closed || output.exit_code.is_some()
                    })
                    .map(|(session_id, _)| session_id.clone())
                    .or_else(|| {
                        let mut ids: Vec<String> = terminals.keys().cloned().collect();
                        ids.sort();
                        ids.into_iter().next()
                    });
                let Some(session_id) = reclaim_id else {
                    break;
                };
                if let Some(session) = terminals.remove(&session_id) {
                    Self::force_close_session(session);
                }
            }
        }
        let size = validated_terminal_size(request.rows, request.columns)?;
        let pty = native_pty_system()
            .openpty(size)
            .map_err(RuntimeError::internal)?;
        let mut command = CommandBuilder::new("/bin/sh");
        command.arg("-l");
        command.cwd(&self.workspace_root);
        command.env("PATH", GUEST_PATH);
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
        Self::force_close_session(session);
        Ok(serde_json::json!({ "closed": true }))
    }

    fn force_close_session(session: Arc<TerminalSession>) {
        {
            let mut writer = session.writer.lock().expect("terminal writer lock");
            let _ = writer.write_all(b"\x03exit\n");
            let _ = writer.flush();
        }
        let mut output = session.output.lock().expect("terminal output lock");
        output.reader_closed = true;
        session.output_changed.notify_all();
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
        let _mutation = self.mutations.lock().expect("mutation lock");
        validate_worktree_id(&request.worktree_id)?;
        validate_commit_sha(&request.head_sha)?;
        if let Some(branch_name) = request.branch_name.as_deref() {
            validate_branch_name(branch_name)?;
        }
        let worktrees_root = self.worktrees_root()?;
        fs::create_dir_all(&worktrees_root).map_err(RuntimeError::internal)?;
        let target = worktrees_root.join(&request.worktree_id);
        if target.exists() {
            return Err(RuntimeError::Conflict("worktree already exists".into()));
        }
        let target_path = target
            .to_str()
            .ok_or_else(|| RuntimeError::Internal("invalid worktree path".into()))?;
        match request.branch_name.as_deref() {
            Some(branch_name) => self.git(
                &self.workspace_root,
                &[
                    "worktree",
                    "add",
                    "-b",
                    branch_name,
                    target_path,
                    &request.head_sha,
                ],
            )?,
            None => self.git(
                &self.workspace_root,
                &[
                    "worktree",
                    "add",
                    "--detach",
                    target_path,
                    &request.head_sha,
                ],
            )?,
        };
        Ok(serde_json::json!({
            "worktreeId": request.worktree_id,
            "headSha": request.head_sha,
            "branchName": request.branch_name,
        }))
    }

    fn delete_worktree(&self, worktree_id: &str) -> crate::model::Result<serde_json::Value> {
        validate_worktree_id(worktree_id)?;
        let _mutation = self.mutations.lock().expect("mutation lock");
        let target = self.worktrees_root()?.join(worktree_id);
        if !target.is_dir() {
            self.git(&self.workspace_root, &["worktree", "prune"])?;
            return Ok(serde_json::json!({ "deleted": false }));
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

    fn checkpoint_worktree(
        &self,
        worktree_id: &str,
        body: &[u8],
    ) -> crate::model::Result<serde_json::Value> {
        validate_worktree_id(worktree_id)?;
        let request: WorktreeCheckpointRequest = decode(body)?;
        validate_commit_sha(&request.expected_head_sha)?;
        let _mutation = self.mutations.lock().expect("mutation lock");
        let root = self.target_root(Some(worktree_id))?;
        // Use the actual current HEAD rather than enforcing expected_head_sha —
        // the agent may have committed since the last poll, which is fine.
        self.git(&root, &["add", "--all"])?;
        let staged = self.git_output(&root, &["diff", "--cached", "--quiet", "--"])?;
        let head_sha = if staged.status.success() {
            // Nothing staged; return the actual current HEAD.
            self.head_sha(&root)?
        } else if staged.status.code() == Some(1) {
            self.git(
                &root,
                &[
                    "-c",
                    "user.name=CoDev",
                    "-c",
                    "user.email=agent@codev.dev",
                    "commit",
                    "--no-gpg-sign",
                    "-m",
                    "CoDev agent checkpoint",
                ],
            )?;
            self.head_sha(&root)?
        } else {
            return Err(git_failure("inspect staged checkpoint", &staged));
        };
        serde_json::to_value(WorktreeCheckpointResponse { head_sha })
            .map_err(RuntimeError::internal)
    }

    fn review_worktree(
        &self,
        worktree_id: &str,
        query: &str,
    ) -> crate::model::Result<serde_json::Value> {
        validate_worktree_id(worktree_id)?;
        let request = parse_review_query(query)?;
        validate_commit_sha(&request.base_sha)?;
        let _mutation = self.mutations.lock().expect("mutation lock");
        let root = self.target_root(Some(worktree_id))?;
        self.require_clean(&root, "checkpoint the worktree before review")?;
        self.require_commit(&request.base_sha)?;
        let head_sha = self.head_sha(&root)?;
        let diff = self.review_diff(&request.base_sha, &head_sha)?;
        let diff_digest = revision(&diff);
        serde_json::to_value(WorktreeReviewResponse {
            base_sha: request.base_sha,
            head_sha,
            diff: String::from_utf8_lossy(&diff).into_owned(),
            diff_digest,
        })
        .map_err(RuntimeError::internal)
    }

    fn rebase_worktree(
        &self,
        worktree_id: &str,
        body: &[u8],
    ) -> crate::model::Result<serde_json::Value> {
        validate_worktree_id(worktree_id)?;
        let request: WorktreeRebaseRequest = decode(body)?;
        validate_commit_sha(&request.expected_head_sha)?;
        validate_commit_sha(&request.onto_sha)?;
        let _mutation = self.mutations.lock().expect("mutation lock");
        let root = self.target_root(Some(worktree_id))?;
        self.require_clean(&root, "checkpoint the worktree before rebasing")?;
        self.require_head(&root, &request.expected_head_sha, "worktree")?;
        self.require_head(&self.workspace_root, &request.onto_sha, "integration")?;
        let output = self.git_output(&root, &["rebase", &request.onto_sha])?;
        if !output.status.success() {
            let conflicts = self
                .git_output(&root, &["diff", "--name-only", "--diff-filter=U", "--"])?
                .stdout;
            let conflict_paths = String::from_utf8_lossy(&conflicts)
                .lines()
                .map(str::to_owned)
                .collect();
            let message = git_error_message("rebase worktree", &output);
            let _ = self.git_output(&root, &["rebase", "--abort"]);
            return Err(RuntimeError::GitConflict {
                message,
                conflict_paths,
            });
        }
        let head_sha = self.head_sha(&root)?;
        serde_json::to_value(WorktreeRebaseResponse { head_sha }).map_err(RuntimeError::internal)
    }

    fn merge_worktree(
        &self,
        worktree_id: &str,
        body: &[u8],
    ) -> crate::model::Result<serde_json::Value> {
        validate_worktree_id(worktree_id)?;
        let request: WorktreeMergeRequest = decode(body)?;
        validate_commit_sha(&request.expected_integration_head_sha)?;
        validate_commit_sha(&request.expected_worktree_head_sha)?;
        validate_digest(&request.expected_diff_digest)?;
        let _mutation = self.mutations.lock().expect("mutation lock");
        if !self.terminals.lock().expect("terminal map lock").is_empty() {
            return Err(RuntimeError::Conflict(
                "close active terminals before merging".into(),
            ));
        }
        let root = self.target_root(Some(worktree_id))?;
        self.require_clean(&root, "checkpoint the worktree before merging")?;
        self.require_clean(&self.workspace_root, "integration worktree is dirty")?;
        self.require_head(
            &self.workspace_root,
            &request.expected_integration_head_sha,
            "integration",
        )?;
        self.require_head(&root, &request.expected_worktree_head_sha, "worktree")?;
        let diff = self.review_diff(
            &request.expected_integration_head_sha,
            &request.expected_worktree_head_sha,
        )?;
        if revision(&diff) != request.expected_diff_digest {
            return Err(RuntimeError::Conflict(
                "reviewed diff digest is stale".into(),
            ));
        }
        let ancestor = self.git_output(
            &self.workspace_root,
            &[
                "merge-base",
                "--is-ancestor",
                &request.expected_integration_head_sha,
                &request.expected_worktree_head_sha,
            ],
        )?;
        if !ancestor.status.success() {
            return Err(RuntimeError::Conflict(
                "worktree must be rebased before merging".into(),
            ));
        }
        self.git(
            &self.workspace_root,
            &["merge", "--ff-only", &request.expected_worktree_head_sha],
        )?;
        let head_sha = self.head_sha(&self.workspace_root)?;
        serde_json::to_value(WorktreeMergeResponse { head_sha }).map_err(RuntimeError::internal)
    }

    fn export_publication(&self, body: &[u8]) -> crate::model::Result<serde_json::Value> {
        // Publications intentionally include the dirty integration tree. The
        // expected commit head still guards against a concurrent merge, while
        // the exported file list carries the uncommitted edits that GitHub
        // needs for the resulting branch and pull request.
        self.export_workspace(body, false)
    }

    fn snapshot_workspace(&self, body: &[u8]) -> crate::model::Result<serde_json::Value> {
        self.export_workspace(body, false)
    }

    fn export_workspace(
        &self,
        body: &[u8],
        require_clean: bool,
    ) -> crate::model::Result<serde_json::Value> {
        const MAX_FILES: usize = 500;
        const MAX_FILE_BYTES: usize = 1 << 20;
        const MAX_TOTAL_BYTES: usize = 5 << 20;

        let request: PublicationExportRequest = decode(body)?;
        validate_commit_sha(&request.expected_head_sha)?;
        if let Some(worktree_id) = request.worktree_id.as_deref() {
            validate_worktree_id(worktree_id)?;
        }
        let _mutation = self.mutations.lock().expect("mutation lock");
        let root = self.target_root(request.worktree_id.as_deref())?;
        let actual_head_sha = self.head_sha(&root)?;
        if require_clean {
            self.require_clean(
                &root,
                if request.worktree_id.is_some() {
                    "worktree is dirty"
                } else {
                    "integration worktree is dirty"
                },
            )?;
        }

        let entries: Vec<(String, String, Vec<u8>)> = if require_clean {
            let tree = self.git_output(&root, &["ls-tree", "-r", "-z", "--full-tree", "HEAD"])?;
            if !tree.status.success() {
                return Err(git_failure("enumerate publication tree", &tree));
            }
            tree.stdout
                .split(|byte| *byte == 0)
                .filter(|row| !row.is_empty())
                .map(|raw| {
                    let row = std::str::from_utf8(raw).map_err(|_| {
                        RuntimeError::BadRequest("publication paths must be UTF-8".into())
                    })?;
                    let (metadata, path) = row
                        .split_once('\t')
                        .ok_or_else(|| RuntimeError::Internal("invalid Git tree entry".into()))?;
                    let mut fields = metadata.split_whitespace();
                    let mode = fields.next().unwrap_or_default();
                    let kind = fields.next().unwrap_or_default();
                    let sha = fields.next().unwrap_or_default();
                    if kind != "blob" || !matches!(mode, "100644" | "100755" | "120000") {
                        return Err(RuntimeError::BadRequest(
                            "publication contains an unsupported Git object".into(),
                        ));
                    }
                    validate_publication_path(path)?;
                    validate_commit_sha(sha)?;
                    let blob = self.git_output(&root, &["cat-file", "blob", sha])?;
                    if !blob.status.success() {
                        return Err(git_failure("read publication blob", &blob));
                    }
                    Ok((path.into(), mode.into(), blob.stdout))
                })
                .collect::<crate::model::Result<Vec<_>>>()?
        } else {
            let listing =
                self.git_output(&root, &["ls-files", "-co", "--exclude-standard", "-z"])?;
            if !listing.status.success() {
                return Err(git_failure("enumerate workspace snapshot", &listing));
            }
            listing
                .stdout
                .split(|byte| *byte == 0)
                .filter(|row| !row.is_empty())
                .map(|raw| {
                    let path = std::str::from_utf8(raw).map_err(|_| {
                        RuntimeError::BadRequest("workspace snapshot paths must be UTF-8".into())
                    })?;
                    validate_publication_path(path)?;
                    let file_path = root.join(path);
                    let metadata = match fs::symlink_metadata(&file_path) {
                        Ok(metadata) => metadata,
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                            return Ok(None);
                        }
                        Err(error) => return Err(RuntimeError::internal(error)),
                    };
                    let (mode, contents) = if metadata.file_type().is_symlink() {
                        (
                            "120000".to_owned(),
                            fs::read_link(&file_path)
                                .map_err(RuntimeError::internal)?
                                .to_string_lossy()
                                .as_bytes()
                                .to_vec(),
                        )
                    } else if metadata.file_type().is_file() {
                        let mode = if metadata.permissions().mode() & 0o111 != 0 {
                            "100755"
                        } else {
                            "100644"
                        };
                        (
                            mode.to_owned(),
                            fs::read(&file_path).map_err(RuntimeError::internal)?,
                        )
                    } else {
                        return Err(RuntimeError::BadRequest(
                            "workspace snapshot contains a non-file entry".into(),
                        ));
                    };
                    Ok(Some((path.into(), mode, contents)))
                })
                .collect::<crate::model::Result<Vec<_>>>()?
                .into_iter()
                .flatten()
                .collect()
        };

        let mut files = Vec::new();
        let mut total_bytes = 0usize;
        for (path, mode, contents) in entries {
            if files.len() >= MAX_FILES {
                return Err(RuntimeError::BadRequest(
                    "publication tree exceeds 500 files".into(),
                ));
            }
            if contents.len() > MAX_FILE_BYTES {
                return Err(RuntimeError::BadRequest(
                    "publication file exceeds one MiB".into(),
                ));
            }
            total_bytes = total_bytes
                .checked_add(contents.len())
                .ok_or_else(|| RuntimeError::BadRequest("publication is too large".into()))?;
            if total_bytes > MAX_TOTAL_BYTES {
                return Err(RuntimeError::BadRequest(
                    "publication exceeds five MiB".into(),
                ));
            }
            files.push(PublicationFile {
                path,
                mode,
                content_base64: BASE64.encode(contents),
            });
        }

        serde_json::to_value(PublicationExportResponse {
            head_sha: actual_head_sha,
            files,
            total_bytes,
        })
        .map_err(RuntimeError::internal)
    }

    fn require_head(&self, root: &Path, expected: &str, label: &str) -> crate::model::Result<()> {
        let actual = self.head_sha(root)?;
        if actual == expected {
            Ok(())
        } else {
            Err(RuntimeError::Conflict(format!(
                "{label} head changed: expected {expected}, found {actual}"
            )))
        }
    }

    fn require_clean(&self, root: &Path, message: &str) -> crate::model::Result<()> {
        let output = self.git_output(root, &["status", "--porcelain=v1"])?;
        if output.status.success() && output.stdout.is_empty() {
            Ok(())
        } else if output.status.success() {
            Err(RuntimeError::Conflict(message.into()))
        } else {
            Err(git_failure("inspect worktree status", &output))
        }
    }

    fn require_commit(&self, sha: &str) -> crate::model::Result<()> {
        let object = format!("{sha}^{{commit}}");
        let output = self.git_output(&self.workspace_root, &["cat-file", "-e", &object])?;
        if output.status.success() {
            Ok(())
        } else {
            Err(RuntimeError::BadRequest("Git commit not found".into()))
        }
    }

    fn head_sha(&self, root: &Path) -> crate::model::Result<String> {
        let output = self.git_output(root, &["rev-parse", "HEAD"])?;
        if !output.status.success() {
            return Err(git_failure("resolve Git head", &output));
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().into())
    }

    fn review_diff(&self, base_sha: &str, head_sha: &str) -> crate::model::Result<Vec<u8>> {
        let range = format!("{base_sha}...{head_sha}");
        let output = self.git_output(
            &self.workspace_root,
            &["diff", "--binary", "--no-ext-diff", &range, "--"],
        )?;
        if output.status.success() {
            Ok(output.stdout)
        } else {
            Err(git_failure("create review diff", &output))
        }
    }

    fn git(&self, root: &Path, arguments: &[&str]) -> crate::model::Result<serde_json::Value> {
        let output = self.git_output(root, arguments)?;
        if !output.status.success() {
            return Err(git_failure("run Git command", &output));
        }
        Ok(serde_json::json!({
            "output": String::from_utf8_lossy(&output.stdout)
        }))
    }

    fn git_output(
        &self,
        root: &Path,
        arguments: &[&str],
    ) -> crate::model::Result<std::process::Output> {
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
        Ok(output)
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

fn validate_branch_name(branch_name: &str) -> crate::model::Result<()> {
    let valid = !branch_name.is_empty()
        && branch_name.len() <= 120
        && !branch_name.starts_with('/')
        && !branch_name.ends_with('/')
        && !branch_name.ends_with(".lock")
        && !branch_name.contains("..")
        && !branch_name.contains("@{")
        && !branch_name.contains("//")
        && branch_name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'/'))
        && branch_name
            .split('/')
            .all(|segment| !segment.is_empty() && !segment.starts_with('.'));
    if valid {
        Ok(())
    } else {
        Err(RuntimeError::BadRequest("invalid branch name".into()))
    }
}

fn validate_publication_path(path: &str) -> crate::model::Result<()> {
    if path.is_empty()
        || path.starts_with('/')
        || path.contains('\\')
        || path.chars().any(char::is_control)
        || path
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        Err(RuntimeError::BadRequest(
            "publication contains an unsafe path".into(),
        ))
    } else {
        Ok(())
    }
}

fn validate_commit_sha(head_sha: &str) -> crate::model::Result<()> {
    if head_sha.len() == 40 && head_sha.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(RuntimeError::BadRequest("invalid worktree head SHA".into()))
    }
}

fn validate_digest(digest: &str) -> crate::model::Result<()> {
    if digest.len() == 64
        && digest
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        Ok(())
    } else {
        Err(RuntimeError::BadRequest("invalid diff digest".into()))
    }
}

fn parse_review_query(query: &str) -> crate::model::Result<WorktreeReviewQuery> {
    let base_sha = query
        .split('&')
        .find_map(|part| part.strip_prefix("baseSha="))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| RuntimeError::BadRequest("baseSha is required".into()))?;
    Ok(WorktreeReviewQuery {
        base_sha: base_sha.into(),
    })
}

fn git_error_message(action: &str, output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let message = stderr.trim();
    if message.is_empty() {
        format!("{action} failed with status {}", output.status)
    } else {
        format!("{action} failed: {message}")
    }
}

fn git_failure(action: &str, output: &std::process::Output) -> RuntimeError {
    RuntimeError::Conflict(git_error_message(action, output))
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
    fn missing_command_returns_a_normal_process_failure() {
        let directory = tempdir().expect("tempdir");
        let service = GuestService::new(directory.path()).expect("service");
        let response = service.handle(
            "POST",
            "/v1/pty/exec",
            br#"{"command":["codev-command-that-is-not-installed"]}"#,
        );
        assert_eq!(response.status, 200);
        let result: ExecResponse = serde_json::from_slice(&response.body).expect("exec");
        assert_eq!(result.exit_code, 127);
        assert!(result.output.contains("Unable to spawn"));
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
                branch_name: None,
                head_sha: head_sha.clone(),
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

        let create_named = service.handle(
            "POST",
            "/v1/worktrees",
            serde_json::to_string(&WorktreeCreateRequest {
                worktree_id: "agent-named".into(),
                branch_name: Some("agent/agent-named".into()),
                head_sha: head_sha.clone(),
            })
            .expect("request")
            .as_bytes(),
        );
        assert_eq!(
            create_named.status,
            200,
            "{}",
            String::from_utf8_lossy(&create_named.body)
        );
        let named_head = service.handle(
            "POST",
            "/v1/pty/exec",
            br#"{"command":["git","symbolic-ref","--short","HEAD"],"worktreeId":"agent-named"}"#,
        );
        assert_eq!(named_head.status, 200);
        let named_result: ExecResponse = serde_json::from_slice(&named_head.body).expect("exec");
        assert_eq!(named_result.exit_code, 0);
        assert_eq!(named_result.output.trim(), "agent/agent-named");

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

        let worktree_root = directory
            .path()
            .join(".git/codev-agent-worktrees/agent-one");
        fs::write(worktree_root.join("created.txt"), "new file").expect("new file");
        let premature_review = service.handle(
            "GET",
            &format!("/v1/worktrees/agent-one/review?baseSha={head_sha}"),
            b"",
        );
        assert_eq!(premature_review.status, 409);
        let agent_advanced_checkpoint = service.handle(
            "POST",
            "/v1/worktrees/agent-one/checkpoint",
            serde_json::to_string(&WorktreeCheckpointRequest {
                expected_head_sha: "0".repeat(40),
            })
            .expect("checkpoint request")
            .as_bytes(),
        );
        // Checkpointing deliberately tolerates an agent advancing HEAD between
        // polls and returns the actual resulting commit.
        assert_eq!(agent_advanced_checkpoint.status, 200);
        let checkpoint = service.handle(
            "POST",
            "/v1/worktrees/agent-one/checkpoint",
            serde_json::to_string(&WorktreeCheckpointRequest {
                expected_head_sha: head_sha.clone(),
            })
            .expect("checkpoint request")
            .as_bytes(),
        );
        assert_eq!(
            checkpoint.status,
            200,
            "{}",
            String::from_utf8_lossy(&checkpoint.body)
        );
        let checkpoint: WorktreeCheckpointResponse =
            serde_json::from_slice(&checkpoint.body).expect("checkpoint");
        assert_ne!(checkpoint.head_sha, head_sha);

        let review = service.handle(
            "GET",
            &format!("/v1/worktrees/agent-one/review?baseSha={head_sha}"),
            b"",
        );
        assert_eq!(review.status, 200);
        let review: WorktreeReviewResponse = serde_json::from_slice(&review.body).expect("review");
        assert!(review.diff.contains("agent edit"));
        assert!(review.diff.contains("created.txt"));
        assert_eq!(review.diff_digest.len(), 64);

        let terminal = service.handle("POST", "/v1/terminals", br#"{}"#);
        assert_eq!(terminal.status, 200);
        let terminal: serde_json::Value = serde_json::from_slice(&terminal.body).expect("terminal");
        let terminal_id = terminal["sessionId"].as_str().expect("terminal id");
        let terminal_blocked_merge = service.handle(
            "POST",
            "/v1/worktrees/agent-one/merge",
            serde_json::to_string(&WorktreeMergeRequest {
                expected_integration_head_sha: head_sha.clone(),
                expected_worktree_head_sha: checkpoint.head_sha.clone(),
                expected_diff_digest: review.diff_digest.clone(),
            })
            .expect("merge request")
            .as_bytes(),
        );
        assert_eq!(terminal_blocked_merge.status, 409);
        assert_eq!(
            service
                .handle("DELETE", &format!("/v1/terminals/{terminal_id}"), b"")
                .status,
            200
        );

        let stale_merge = service.handle(
            "POST",
            "/v1/worktrees/agent-one/merge",
            serde_json::to_string(&WorktreeMergeRequest {
                expected_integration_head_sha: head_sha.clone(),
                expected_worktree_head_sha: checkpoint.head_sha.clone(),
                expected_diff_digest: "0".repeat(64),
            })
            .expect("merge request")
            .as_bytes(),
        );
        assert_eq!(stale_merge.status, 409);
        assert_eq!(
            fs::read_to_string(directory.path().join("hello.txt")).expect("integration read"),
            "integration"
        );

        fs::write(directory.path().join("dirty.txt"), "dirty").expect("dirty integration");
        let dirty_merge = service.handle(
            "POST",
            "/v1/worktrees/agent-one/merge",
            serde_json::to_string(&WorktreeMergeRequest {
                expected_integration_head_sha: head_sha.clone(),
                expected_worktree_head_sha: checkpoint.head_sha.clone(),
                expected_diff_digest: review.diff_digest.clone(),
            })
            .expect("merge request")
            .as_bytes(),
        );
        assert_eq!(dirty_merge.status, 409);
        fs::remove_file(directory.path().join("dirty.txt")).expect("clean integration");

        let merge = service.handle(
            "POST",
            "/v1/worktrees/agent-one/merge",
            serde_json::to_string(&WorktreeMergeRequest {
                expected_integration_head_sha: head_sha,
                expected_worktree_head_sha: checkpoint.head_sha.clone(),
                expected_diff_digest: review.diff_digest,
            })
            .expect("merge request")
            .as_bytes(),
        );
        assert_eq!(
            merge.status,
            200,
            "{}",
            String::from_utf8_lossy(&merge.body)
        );
        let merge: WorktreeMergeResponse = serde_json::from_slice(&merge.body).expect("merge");
        assert_eq!(merge.head_sha, checkpoint.head_sha);
        assert_eq!(
            fs::read_to_string(directory.path().join("hello.txt")).expect("merged read"),
            "agent edit"
        );
        assert_eq!(
            fs::read_to_string(directory.path().join("created.txt")).expect("new file read"),
            "new file"
        );

        let invalid = service.handle("GET", "/v1/git/status?worktreeId=../integration", b"");
        assert_eq!(invalid.status, 400);

        let delete = service.handle("DELETE", "/v1/worktrees/agent-one", b"");
        assert_eq!(
            delete.status,
            200,
            "{}",
            String::from_utf8_lossy(&delete.body)
        );
        let repeated_delete = service.handle("DELETE", "/v1/worktrees/agent-one", b"");
        assert_eq!(repeated_delete.status, 200);
        let missing = service.handle("GET", "/v1/git/status?worktreeId=agent-one", b"");
        assert_eq!(missing.status, 400);
    }

    #[test]
    fn rebase_reports_conflicts_and_aborts_without_losing_checkpoint() {
        let directory = tempdir().expect("tempdir");
        git(directory.path(), &["init", "--quiet"]);
        git(
            directory.path(),
            &["config", "user.email", "codev@example.com"],
        );
        git(directory.path(), &["config", "user.name", "CoDev Test"]);
        fs::write(directory.path().join("shared.txt"), "base\n").expect("shared");
        fs::write(directory.path().join("agent.txt"), "base\n").expect("agent");
        fs::write(directory.path().join("integration.txt"), "base\n").expect("integration");
        git(directory.path(), &["add", "--all"]);
        git(directory.path(), &["commit", "--quiet", "-m", "seed"]);
        let base_sha = git_stdout(directory.path(), &["rev-parse", "HEAD"]);
        let service = GuestService::new(directory.path()).expect("service");

        for worktree_id in ["agent-rebase", "agent-conflict"] {
            let create = service.handle(
                "POST",
                "/v1/worktrees",
                serde_json::to_string(&WorktreeCreateRequest {
                    worktree_id: worktree_id.into(),
                    branch_name: None,
                    head_sha: base_sha.clone(),
                })
                .expect("create request")
                .as_bytes(),
            );
            assert_eq!(create.status, 200);
        }
        let roots = directory.path().join(".git/codev-agent-worktrees");
        fs::write(roots.join("agent-rebase/agent.txt"), "agent change\n").expect("agent edit");
        fs::write(roots.join("agent-conflict/shared.txt"), "agent conflict\n")
            .expect("conflict edit");
        let rebase_checkpoint = checkpoint(&service, "agent-rebase", &base_sha);
        let conflict_checkpoint = checkpoint(&service, "agent-conflict", &base_sha);

        fs::write(
            directory.path().join("integration.txt"),
            "integration change\n",
        )
        .expect("integration edit");
        fs::write(
            directory.path().join("shared.txt"),
            "integration conflict\n",
        )
        .expect("integration conflict");
        git(directory.path(), &["add", "--all"]);
        git(
            directory.path(),
            &["commit", "--quiet", "-m", "integration"],
        );
        let integration_sha = git_stdout(directory.path(), &["rev-parse", "HEAD"]);

        let rebased = service.handle(
            "POST",
            "/v1/worktrees/agent-rebase/rebase",
            serde_json::to_string(&WorktreeRebaseRequest {
                expected_head_sha: rebase_checkpoint.head_sha,
                onto_sha: integration_sha.clone(),
            })
            .expect("rebase request")
            .as_bytes(),
        );
        assert_eq!(
            rebased.status,
            200,
            "{}",
            String::from_utf8_lossy(&rebased.body)
        );
        let rebased: WorktreeRebaseResponse =
            serde_json::from_slice(&rebased.body).expect("rebase");
        assert_ne!(rebased.head_sha, integration_sha);
        assert_eq!(
            fs::read_to_string(roots.join("agent-rebase/integration.txt"))
                .expect("rebased integration file"),
            "integration change\n"
        );

        let conflicted = service.handle(
            "POST",
            "/v1/worktrees/agent-conflict/rebase",
            serde_json::to_string(&WorktreeRebaseRequest {
                expected_head_sha: conflict_checkpoint.head_sha.clone(),
                onto_sha: integration_sha,
            })
            .expect("rebase request")
            .as_bytes(),
        );
        assert_eq!(conflicted.status, 409);
        let payload: serde_json::Value =
            serde_json::from_slice(&conflicted.body).expect("conflict payload");
        assert_eq!(payload["conflictPaths"][0], "shared.txt");
        assert_eq!(
            git_stdout(&roots.join("agent-conflict"), &["rev-parse", "HEAD"]),
            conflict_checkpoint.head_sha
        );
        assert!(
            git_stdout(&roots.join("agent-conflict"), &["status", "--porcelain=v1"]).is_empty()
        );
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

    #[test]
    fn terminal_start_reclaims_oldest_when_at_capacity() {
        let directory = tempdir().expect("tempdir");
        let service = GuestService::new(directory.path()).expect("service");
        let mut session_ids = Vec::new();
        for _ in 0..MAX_LIVE_TERMINALS {
            let start = service.handle("POST", "/v1/terminals", br#"{"rows":24,"columns":80}"#);
            assert_eq!(
                start.status,
                200,
                "{}",
                String::from_utf8_lossy(&start.body)
            );
            let body: serde_json::Value =
                serde_json::from_slice(&start.body).expect("terminal start");
            session_ids.push(body["sessionId"].as_str().expect("session id").to_owned());
        }

        let overflow = service.handle("POST", "/v1/terminals", br#"{"rows":24,"columns":80}"#);
        assert_eq!(
            overflow.status,
            200,
            "new terminal should reclaim a slot instead of failing: {}",
            String::from_utf8_lossy(&overflow.body)
        );
        let overflow_body: serde_json::Value =
            serde_json::from_slice(&overflow.body).expect("overflow start");
        let new_id = overflow_body["sessionId"].as_str().expect("new session id");
        assert!(!session_ids.iter().any(|id| id == new_id));

        // Oldest session should be gone; interacting with it must fail.
        let oldest = &session_ids[0];
        let stale = service.handle(
            "POST",
            &format!("/v1/terminals/{oldest}/input"),
            br#"{"data":"echo stale\n"}"#,
        );
        assert_eq!(stale.status, 400);

        let close = service.handle("DELETE", &format!("/v1/terminals/{new_id}"), b"");
        assert_eq!(close.status, 200);
    }

    #[test]
    fn workspace_snapshot_preserves_dirty_files_and_deletions() {
        let directory = tempdir().expect("tempdir");
        git(directory.path(), &["init", "--quiet"]);
        git(
            directory.path(),
            &["config", "user.email", "codev@example.com"],
        );
        git(directory.path(), &["config", "user.name", "CoDev Test"]);
        fs::write(directory.path().join("changed.txt"), "before\n").expect("changed");
        fs::write(directory.path().join("deleted.txt"), "remove me\n").expect("deleted");
        git(directory.path(), &["add", "--all"]);
        git(directory.path(), &["commit", "--quiet", "-m", "seed"]);
        let head_sha = git_stdout(directory.path(), &["rev-parse", "HEAD"]);
        fs::write(directory.path().join("changed.txt"), "after\n").expect("dirty change");
        fs::remove_file(directory.path().join("deleted.txt")).expect("remove");
        fs::write(directory.path().join("new.txt"), "new\n").expect("new");

        let service = GuestService::new(directory.path()).expect("service");
        for endpoint in ["/v1/workspace/snapshot", "/v1/publication/export"] {
            let response = service.handle(
                "POST",
                endpoint,
                serde_json::to_string(&PublicationExportRequest {
                    expected_head_sha: head_sha.clone(),
                    worktree_id: None,
                })
                .expect("export request")
                .as_bytes(),
            );
            assert_eq!(
                response.status,
                200,
                "{}: {}",
                endpoint,
                String::from_utf8_lossy(&response.body)
            );
            let export: PublicationExportResponse =
                serde_json::from_slice(&response.body).expect("export");
            let files = export
                .files
                .iter()
                .map(|file| (file.path.as_str(), file.content_base64.as_str()))
                .collect::<HashMap<_, _>>();
            assert_eq!(
                BASE64.decode(files["changed.txt"]).expect("changed base64"),
                b"after\n"
            );
            assert_eq!(
                BASE64.decode(files["new.txt"]).expect("new base64"),
                b"new\n"
            );
            assert!(!files.contains_key("deleted.txt"));
        }
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

    fn git_stdout(root: &Path, arguments: &[&str]) -> String {
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
        String::from_utf8(output.stdout)
            .expect("git output")
            .trim()
            .into()
    }

    fn checkpoint(
        service: &GuestService,
        worktree_id: &str,
        expected_head_sha: &str,
    ) -> WorktreeCheckpointResponse {
        let response = service.handle(
            "POST",
            &format!("/v1/worktrees/{worktree_id}/checkpoint"),
            serde_json::to_string(&WorktreeCheckpointRequest {
                expected_head_sha: expected_head_sha.into(),
            })
            .expect("checkpoint request")
            .as_bytes(),
        );
        assert_eq!(
            response.status,
            200,
            "{}",
            String::from_utf8_lossy(&response.body)
        );
        serde_json::from_slice(&response.body).expect("checkpoint")
    }
}
