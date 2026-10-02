use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, RwLock},
};

use chrono::{Duration, Utc};

use crate::model::{
    ClaudeSetupCodeRequest, ClaudeSetupPollRequest, ClaudeSetupPollResponse,
    ClaudeSetupStartRequest, CodexExecPollRequest, CodexExecPollResponse, CodexExecStartRequest,
    CreateRequest, ExecRequest, ExecResponse, FileResponse, Instance, Result, RuntimeError,
    SupersetAgentInputRequest, SupersetAgentPollRequest, SupersetAgentPollResponse,
    SupersetAgentRecoveryResponse, SupersetAgentStartRequest, SupersetAgentStartResponse,
    SupersetCreateEntryRequest, SupersetDeleteEntryRequest, SupersetMoveEntryRequest,
    TerminalInputRequest, TerminalPollRequest, TerminalPollResponse, TerminalResizeRequest,
    TerminalStartRequest, WriteFileRequest,
};

const MAX_ACTIVE_SESSIONS: usize = 3;

#[cfg(target_os = "linux")]
mod firecracker;
#[cfg(target_os = "linux")]
pub use firecracker::{FirecrackerBackend, FirecrackerConfig};

#[allow(clippy::large_enum_variant)]
pub enum Backend {
    Fake(FakeBackend),
    #[cfg(target_os = "linux")]
    Firecracker(FirecrackerBackend),
}

impl Backend {
    pub fn fake() -> Self {
        Self::Fake(FakeBackend::new())
    }

    /// Preserve durable workspaces after draining requests during a service restart.
    pub async fn shutdown(&self) -> Result<()> {
        match self {
            Self::Fake(_) => Ok(()),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.shutdown().await,
        }
    }

    pub async fn health(&self) -> Result<()> {
        match self {
            Self::Fake(backend) => backend.health(),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.health().await,
        }
    }

    pub async fn active_count(&self) -> usize {
        match self {
            Self::Fake(backend) => backend.active_count(),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.active_count().await,
        }
    }

    /// Atomically reserve an otherwise empty host for shutdown. Sandbox
    /// creation takes the same lifecycle lock, so it either completes before
    /// this reservation (and prevents shutdown), or observes the reservation
    /// and retries through the normal host-wake path instead of starting a
    /// guest on a VM that is being deallocated.
    pub async fn begin_host_shutdown_if_idle(&self) -> bool {
        match self {
            Self::Fake(backend) => backend.begin_host_shutdown_if_idle(),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.begin_host_shutdown_if_idle().await,
        }
    }

    /// Clear a shutdown reservation after the Azure deallocation helper
    /// failed, allowing the host to continue serving sandbox requests.
    pub fn cancel_host_shutdown(&self) {
        match self {
            Self::Fake(backend) => backend.cancel_host_shutdown(),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.cancel_host_shutdown(),
        }
    }

    /// Reap expired short-lived sandboxes and hibernate durable idle ones.
    /// This is a host-level backstop for callers that disappear before DELETE.
    pub async fn reap_expired(&self) -> usize {
        match self {
            Self::Fake(backend) => backend.reap_expired(),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.reap_expired().await,
        }
    }

    pub async fn create(&self, request: CreateRequest) -> Result<Instance> {
        match self {
            Self::Fake(backend) => backend.create(request),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.create(request).await,
        }
    }

    pub async fn get(&self, workspace_id: &str) -> Result<Instance> {
        match self {
            Self::Fake(backend) => backend.get(workspace_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.get(workspace_id).await,
        }
    }

    pub async fn touch(&self, workspace_id: &str) -> Result<Instance> {
        match self {
            Self::Fake(backend) => backend.touch(workspace_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.touch(workspace_id).await,
        }
    }

    pub async fn park(&self, workspace_id: &str) -> Result<Instance> {
        match self {
            Self::Fake(backend) => backend.park(workspace_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.park(workspace_id).await,
        }
    }

    pub async fn destroy(&self, workspace_id: &str) -> Result<()> {
        match self {
            Self::Fake(backend) => backend.destroy(workspace_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.destroy(workspace_id).await,
        }
    }

    pub async fn resume(&self, workspace_id: &str) -> Result<()> {
        match self {
            Self::Fake(backend) => backend.resume(workspace_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.resume(workspace_id).await,
        }
    }

    pub async fn discard_snapshot(&self, workspace_id: &str) -> Result<()> {
        match self {
            Self::Fake(backend) => backend.discard_snapshot(workspace_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.discard_snapshot(workspace_id).await,
        }
    }

    pub async fn read_file(
        &self,
        workspace_id: &str,
        path: String,
        worktree_id: Option<&str>,
    ) -> Result<FileResponse> {
        match self {
            Self::Fake(backend) => backend.read_file(workspace_id, path, worktree_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.read_file(workspace_id, path, worktree_id).await,
        }
    }

    pub async fn superset_health(&self, workspace_id: &str) -> Result<()> {
        match self {
            Self::Fake(_) => {
                let _ = workspace_id;
                Err(RuntimeError::Unavailable(
                    "Superset host service is unavailable in the fake backend".into(),
                ))
            }
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.superset_health(workspace_id).await,
        }
    }

    pub async fn superset_list_files(
        &self,
        _workspace_id: &str,
        _worktree_id: &str,
    ) -> Result<serde_json::Value> {
        match self {
            Self::Fake(_) => Err(RuntimeError::Unavailable(
                "Superset host service is unavailable in the fake backend".into(),
            )),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => {
                backend
                    .superset_list_files(_workspace_id, _worktree_id)
                    .await
            }
        }
    }

    pub async fn superset_read_file(
        &self,
        _workspace_id: &str,
        _path: String,
        _worktree_id: &str,
    ) -> Result<serde_json::Value> {
        match self {
            Self::Fake(_) => Err(RuntimeError::Unavailable(
                "Superset host service is unavailable in the fake backend".into(),
            )),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => {
                backend
                    .superset_read_file(_workspace_id, _path, _worktree_id)
                    .await
            }
        }
    }

    pub async fn superset_write_file(
        &self,
        _workspace_id: &str,
        _request: &WriteFileRequest,
    ) -> Result<serde_json::Value> {
        match self {
            Self::Fake(_) => Err(RuntimeError::Unavailable(
                "Superset host service is unavailable in the fake backend".into(),
            )),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => {
                backend.superset_write_file(_workspace_id, _request).await
            }
        }
    }

    pub async fn superset_create_entry(
        &self,
        _workspace_id: &str,
        _request: &SupersetCreateEntryRequest,
    ) -> Result<serde_json::Value> {
        match self {
            Self::Fake(_) => Err(RuntimeError::Unavailable(
                "Superset host service is unavailable in the fake backend".into(),
            )),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => {
                backend.superset_create_entry(_workspace_id, _request).await
            }
        }
    }

    pub async fn superset_move_entry(
        &self,
        _workspace_id: &str,
        _request: &SupersetMoveEntryRequest,
    ) -> Result<serde_json::Value> {
        match self {
            Self::Fake(_) => Err(RuntimeError::Unavailable(
                "Superset host service is unavailable in the fake backend".into(),
            )),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => {
                backend.superset_move_entry(_workspace_id, _request).await
            }
        }
    }

    pub async fn superset_delete_entry(
        &self,
        _workspace_id: &str,
        _request: &SupersetDeleteEntryRequest,
    ) -> Result<serde_json::Value> {
        match self {
            Self::Fake(_) => Err(RuntimeError::Unavailable(
                "Superset host service is unavailable in the fake backend".into(),
            )),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => {
                backend.superset_delete_entry(_workspace_id, _request).await
            }
        }
    }

    pub async fn superset_file_changes(
        &self,
        _workspace_id: &str,
        _worktree_id: &str,
    ) -> Result<serde_json::Value> {
        match self {
            Self::Fake(_) => Err(RuntimeError::Unavailable(
                "Superset host service is unavailable in the fake backend".into(),
            )),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => {
                backend
                    .superset_file_changes(_workspace_id, _worktree_id)
                    .await
            }
        }
    }

    pub async fn superset_runtime(
        &self,
        _workspace_id: &str,
        _method: &str,
        _operation: &str,
        _body: Option<&serde_json::Value>,
    ) -> Result<serde_json::Value> {
        match self {
            Self::Fake(_) => Err(RuntimeError::Unavailable(
                "Superset host service is unavailable in the fake backend".into(),
            )),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => {
                backend
                    .superset_runtime(_workspace_id, _method, _operation, _body)
                    .await
            }
        }
    }

    pub async fn write_file(
        &self,
        workspace_id: &str,
        request: WriteFileRequest,
    ) -> Result<String> {
        match self {
            Self::Fake(backend) => backend.write_file(workspace_id, request),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.write_file(workspace_id, request).await,
        }
    }

    pub async fn exec(&self, workspace_id: &str, request: ExecRequest) -> Result<ExecResponse> {
        match self {
            Self::Fake(backend) => backend.exec(workspace_id, request),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.exec(workspace_id, request).await,
        }
    }

    pub async fn start_terminal(
        &self,
        workspace_id: &str,
        request: TerminalStartRequest,
    ) -> Result<String> {
        #[cfg(not(target_os = "linux"))]
        let _ = &request;
        match self {
            Self::Fake(backend) => backend.start_terminal(workspace_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.start_terminal(workspace_id, request).await,
        }
    }

    pub async fn input_terminal(
        &self,
        workspace_id: &str,
        session_id: &str,
        request: TerminalInputRequest,
    ) -> Result<()> {
        #[cfg(not(target_os = "linux"))]
        let _ = &request;
        match self {
            Self::Fake(backend) => backend.input_terminal(workspace_id, session_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => {
                backend
                    .input_terminal(workspace_id, session_id, request)
                    .await
            }
        }
    }

    pub async fn resize_terminal(
        &self,
        workspace_id: &str,
        session_id: &str,
        request: TerminalResizeRequest,
    ) -> Result<()> {
        #[cfg(not(target_os = "linux"))]
        let _ = &request;
        match self {
            Self::Fake(backend) => backend.input_terminal(workspace_id, session_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => {
                backend
                    .resize_terminal(workspace_id, session_id, request)
                    .await
            }
        }
    }

    pub async fn poll_terminal(
        &self,
        workspace_id: &str,
        session_id: &str,
        request: TerminalPollRequest,
    ) -> Result<TerminalPollResponse> {
        match self {
            Self::Fake(backend) => backend.poll_terminal(workspace_id, session_id, request),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => {
                backend
                    .poll_terminal(workspace_id, session_id, request)
                    .await
            }
        }
    }

    pub async fn close_terminal(&self, workspace_id: &str, session_id: &str) -> Result<()> {
        match self {
            Self::Fake(backend) => backend.input_terminal(workspace_id, session_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.close_terminal(workspace_id, session_id).await,
        }
    }

    pub async fn start_codex_exec(
        &self,
        workspace_id: &str,
        request: CodexExecStartRequest,
    ) -> Result<String> {
        #[cfg(not(target_os = "linux"))]
        let _ = &request;
        match self {
            Self::Fake(backend) => backend.start_codex_exec(workspace_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.start_codex_exec(workspace_id, request).await,
        }
    }

    pub async fn poll_codex_exec(
        &self,
        workspace_id: &str,
        session_id: &str,
        request: CodexExecPollRequest,
    ) -> Result<CodexExecPollResponse> {
        #[cfg(not(target_os = "linux"))]
        let _ = &request;
        match self {
            Self::Fake(backend) => backend.poll_codex_exec(workspace_id, session_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => {
                backend
                    .poll_codex_exec(workspace_id, session_id, request)
                    .await
            }
        }
    }

    pub async fn close_codex_exec(&self, workspace_id: &str, session_id: &str) -> Result<()> {
        match self {
            Self::Fake(backend) => backend.close_codex_exec(workspace_id, session_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.close_codex_exec(workspace_id, session_id).await,
        }
    }

    pub async fn start_superset_agent(
        &self,
        workspace_id: &str,
        request: SupersetAgentStartRequest,
    ) -> Result<SupersetAgentStartResponse> {
        #[cfg(not(target_os = "linux"))]
        let _ = &request;
        match self {
            Self::Fake(backend) => backend.start_superset_agent(workspace_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.start_superset_agent(workspace_id, request).await,
        }
    }

    pub async fn input_superset_agent(
        &self,
        workspace_id: &str,
        agent_id: &str,
        request: SupersetAgentInputRequest,
    ) -> Result<()> {
        #[cfg(not(target_os = "linux"))]
        let _ = &request;
        match self {
            Self::Fake(backend) => backend.input_superset_agent(workspace_id, agent_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => {
                backend
                    .input_superset_agent(workspace_id, agent_id, request)
                    .await
            }
        }
    }

    pub async fn poll_superset_agent(
        &self,
        workspace_id: &str,
        agent_id: &str,
        request: SupersetAgentPollRequest,
    ) -> Result<SupersetAgentPollResponse> {
        #[cfg(not(target_os = "linux"))]
        let _ = &request;
        match self {
            Self::Fake(backend) => backend.poll_superset_agent(workspace_id, agent_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => {
                backend
                    .poll_superset_agent(workspace_id, agent_id, request)
                    .await
            }
        }
    }

    pub async fn close_superset_agent(&self, workspace_id: &str, agent_id: &str) -> Result<()> {
        match self {
            Self::Fake(backend) => backend.close_superset_agent(workspace_id, agent_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => {
                backend.close_superset_agent(workspace_id, agent_id).await
            }
        }
    }

    pub async fn recover_superset_agent(
        &self,
        workspace_id: &str,
        agent_id: &str,
    ) -> Result<SupersetAgentRecoveryResponse> {
        match self {
            Self::Fake(backend) => backend.recover_superset_agent(workspace_id, agent_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => {
                backend.recover_superset_agent(workspace_id, agent_id).await
            }
        }
    }

    pub async fn start_claude_setup(
        &self,
        workspace_id: &str,
        request: ClaudeSetupStartRequest,
    ) -> Result<serde_json::Value> {
        #[cfg(not(target_os = "linux"))]
        let _ = &request;
        match self {
            Self::Fake(backend) => backend.start_claude_setup(workspace_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.start_claude_setup(workspace_id, request).await,
        }
    }

    pub async fn input_claude_setup_code(
        &self,
        workspace_id: &str,
        session_id: &str,
        request: ClaudeSetupCodeRequest,
    ) -> Result<()> {
        #[cfg(not(target_os = "linux"))]
        let _ = &request;
        match self {
            Self::Fake(backend) => backend.input_claude_setup_code(workspace_id, session_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => {
                backend
                    .input_claude_setup_code(workspace_id, session_id, request)
                    .await
            }
        }
    }

    pub async fn poll_claude_setup(
        &self,
        workspace_id: &str,
        session_id: &str,
        request: ClaudeSetupPollRequest,
    ) -> Result<ClaudeSetupPollResponse> {
        #[cfg(not(target_os = "linux"))]
        let _ = &request;
        match self {
            Self::Fake(backend) => backend.poll_claude_setup(workspace_id, session_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => {
                backend
                    .poll_claude_setup(workspace_id, session_id, request)
                    .await
            }
        }
    }

    pub async fn close_claude_setup(&self, workspace_id: &str, session_id: &str) -> Result<()> {
        match self {
            Self::Fake(backend) => backend.close_claude_setup(workspace_id, session_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => {
                backend.close_claude_setup(workspace_id, session_id).await
            }
        }
    }

    pub async fn git_status(
        &self,
        workspace_id: &str,
        worktree_id: Option<&str>,
    ) -> Result<String> {
        match self {
            Self::Fake(backend) => backend.git_status(workspace_id, worktree_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.git_status(workspace_id, worktree_id).await,
        }
    }

    pub async fn git_diff(&self, workspace_id: &str, worktree_id: Option<&str>) -> Result<String> {
        match self {
            Self::Fake(backend) => backend.git_diff(workspace_id, worktree_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.git_diff(workspace_id, worktree_id).await,
        }
    }
}

pub type SharedBackend = Arc<Backend>;

pub struct FakeBackend {
    instances: RwLock<HashMap<String, Instance>>,
    ephemeral: RwLock<HashSet<String>>,
    parked: RwLock<HashSet<String>>,
    host_shutdown_pending: std::sync::atomic::AtomicBool,
    max: usize,
}

impl Default for FakeBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl FakeBackend {
    pub fn new() -> Self {
        Self {
            instances: RwLock::new(HashMap::new()),
            ephemeral: RwLock::new(HashSet::new()),
            parked: RwLock::new(HashSet::new()),
            host_shutdown_pending: std::sync::atomic::AtomicBool::new(false),
            max: MAX_ACTIVE_SESSIONS,
        }
    }

    fn health(&self) -> Result<()> {
        Ok(())
    }

    fn active_count(&self) -> usize {
        self.instances.read().expect("fake backend lock").len()
    }

    fn begin_host_shutdown_if_idle(&self) -> bool {
        let instances = self.instances.read().expect("fake backend lock");
        if !instances.is_empty() {
            return false;
        }
        self.host_shutdown_pending
            .store(true, std::sync::atomic::Ordering::Release);
        true
    }

    fn cancel_host_shutdown(&self) {
        self.host_shutdown_pending
            .store(false, std::sync::atomic::Ordering::Release);
    }

    fn reap_expired(&self) -> usize {
        let mut instances = self.instances.write().expect("fake backend lock");
        let mut ephemeral = self.ephemeral.write().expect("fake backend lock");
        let before = instances.len();
        let now = Utc::now();
        instances.retain(|workspace_id, instance| {
            !ephemeral.contains(workspace_id) || instance.expires_at > now
        });
        ephemeral.retain(|workspace_id| instances.contains_key(workspace_id));
        self.parked
            .write()
            .expect("fake backend lock")
            .retain(|workspace_id| instances.contains_key(workspace_id));
        before - instances.len()
    }

    fn create(&self, request: CreateRequest) -> Result<Instance> {
        let mut instances = self.instances.write().expect("fake backend lock");
        if self
            .host_shutdown_pending
            .load(std::sync::atomic::Ordering::Acquire)
        {
            return Err(RuntimeError::Unavailable(
                "Firecracker host is shutting down".into(),
            ));
        }
        if let Some(instance) = instances.get_mut(&request.workspace_id) {
            if request.ephemeral
                && self
                    .ephemeral
                    .read()
                    .expect("fake backend lock")
                    .contains(&request.workspace_id)
            {
                instance.expires_at = request.expires_at;
                instance.last_activity_at = Utc::now();
                self.parked
                    .write()
                    .expect("fake backend lock")
                    .remove(&request.workspace_id);
            }
            return Ok(instance.clone());
        }
        if instances.len() >= self.max {
            let mut parked = self.parked.write().expect("fake backend lock");
            if let Some(id) = parked.iter().next().cloned() {
                parked.remove(&id);
                instances.remove(&id);
                self.ephemeral
                    .write()
                    .expect("fake backend lock")
                    .remove(&id);
            } else {
                return Err(RuntimeError::CapacityExceeded);
            }
        }
        let now = Utc::now();
        let instance = Instance {
            id: format!("sandbox-{}", request.workspace_id),
            workspace_id: request.workspace_id.clone(),
            status: "ready".into(),
            head_sha: request.base_sha.clone(),
            created_at: now,
            last_activity_at: now,
            expires_at: request.expires_at,
        };
        if request.ephemeral {
            self.ephemeral
                .write()
                .expect("fake backend lock")
                .insert(request.workspace_id.clone());
        }
        instances.insert(request.workspace_id, instance.clone());
        Ok(instance)
    }

    fn get(&self, workspace_id: &str) -> Result<Instance> {
        self.instances
            .read()
            .expect("fake backend lock")
            .get(workspace_id)
            .cloned()
            .ok_or(RuntimeError::SandboxNotFound)
    }

    fn touch(&self, workspace_id: &str) -> Result<Instance> {
        let mut instances = self.instances.write().expect("fake backend lock");
        let instance = instances
            .get_mut(workspace_id)
            .ok_or(RuntimeError::SandboxNotFound)?;
        let now = Utc::now();
        instance.last_activity_at = now;
        instance.expires_at = now + Duration::hours(4);
        Ok(instance.clone())
    }

    fn park(&self, workspace_id: &str) -> Result<Instance> {
        let mut instances = self.instances.write().expect("fake backend lock");
        if !self
            .ephemeral
            .read()
            .expect("fake backend lock")
            .contains(workspace_id)
        {
            return Err(RuntimeError::BadRequest(
                "only ephemeral sandboxes can be parked".into(),
            ));
        }
        let instance = instances
            .get_mut(workspace_id)
            .ok_or(RuntimeError::SandboxNotFound)?;
        let now = Utc::now();
        instance.last_activity_at = now;
        instance.expires_at = now + Duration::minutes(3);
        self.parked
            .write()
            .expect("fake backend lock")
            .insert(workspace_id.to_owned());
        Ok(instance.clone())
    }

    fn destroy(&self, workspace_id: &str) -> Result<()> {
        let removed = self
            .instances
            .write()
            .expect("fake backend lock")
            .remove(workspace_id)
            .is_some();
        if !removed {
            return Err(RuntimeError::SandboxNotFound);
        }
        self.ephemeral
            .write()
            .expect("fake backend lock")
            .remove(workspace_id);
        self.parked
            .write()
            .expect("fake backend lock")
            .remove(workspace_id);
        Ok(())
    }

    fn resume(&self, workspace_id: &str) -> Result<()> {
        self.get(workspace_id).map(|_| ())
    }

    fn discard_snapshot(&self, _workspace_id: &str) -> Result<()> {
        Ok(())
    }

    fn read_file(
        &self,
        workspace_id: &str,
        path: String,
        _worktree_id: Option<&str>,
    ) -> Result<FileResponse> {
        self.get(workspace_id)?;
        Ok(FileResponse {
            path,
            contents: String::new(),
            revision: "missing".into(),
        })
    }

    fn write_file(&self, workspace_id: &str, request: WriteFileRequest) -> Result<String> {
        self.get(workspace_id)?;
        Ok(format!("{}:next", request.expected_revision))
    }

    fn exec(&self, workspace_id: &str, _request: ExecRequest) -> Result<ExecResponse> {
        self.get(workspace_id)?;
        Ok(ExecResponse {
            output: String::new(),
            exit_code: 0,
            codex_auth_cache_json: None,
        })
    }

    fn start_terminal(&self, workspace_id: &str) -> Result<String> {
        self.get(workspace_id)?;
        Ok("term-1-1".into())
    }

    fn input_terminal(&self, workspace_id: &str, _session_id: &str) -> Result<()> {
        self.get(workspace_id)?;
        Ok(())
    }

    fn poll_terminal(
        &self,
        workspace_id: &str,
        _session_id: &str,
        request: TerminalPollRequest,
    ) -> Result<TerminalPollResponse> {
        self.get(workspace_id)?;
        Ok(TerminalPollResponse {
            chunks: Vec::new(),
            next_sequence: request.after + 1,
            exited: false,
            exit_code: None,
        })
    }

    fn start_codex_exec(&self, workspace_id: &str) -> Result<String> {
        self.get(workspace_id)?;
        Ok("codex-1-1".into())
    }

    fn poll_codex_exec(
        &self,
        workspace_id: &str,
        _session_id: &str,
    ) -> Result<CodexExecPollResponse> {
        self.get(workspace_id)?;
        Ok(CodexExecPollResponse {
            chunks: Vec::new(),
            next_sequence: 1,
            exited: true,
            exit_code: Some(0),
            codex_auth_cache_json: None,
        })
    }

    fn close_codex_exec(&self, workspace_id: &str, _session_id: &str) -> Result<()> {
        self.get(workspace_id)?;
        Ok(())
    }

    fn start_superset_agent(&self, workspace_id: &str) -> Result<SupersetAgentStartResponse> {
        self.get(workspace_id)?;
        Ok(SupersetAgentStartResponse {
            host_workspace_id: "fake-host-workspace".into(),
            host_terminal_id: "fake-terminal-1".into(),
            host_agent_session_id: "fake-agent-1".into(),
        })
    }

    fn input_superset_agent(&self, workspace_id: &str, _agent_id: &str) -> Result<()> {
        self.get(workspace_id)?;
        Ok(())
    }

    fn poll_superset_agent(
        &self,
        workspace_id: &str,
        _agent_id: &str,
    ) -> Result<SupersetAgentPollResponse> {
        self.get(workspace_id)?;
        Ok(SupersetAgentPollResponse {
            chunks: Vec::new(),
            next_sequence: 1,
            exited: true,
            exit_code: Some(0),
            refresh_ready: true,
        })
    }

    fn close_superset_agent(&self, workspace_id: &str, _agent_id: &str) -> Result<()> {
        self.get(workspace_id)?;
        Ok(())
    }

    fn recover_superset_agent(
        &self,
        workspace_id: &str,
        _agent_id: &str,
    ) -> Result<SupersetAgentRecoveryResponse> {
        self.get(workspace_id)?;
        // No real Superset host backs the fake backend, so there is never
        // anything to adopt.
        Ok(SupersetAgentRecoveryResponse { adoptable: false })
    }

    fn start_claude_setup(&self, workspace_id: &str) -> Result<serde_json::Value> {
        self.get(workspace_id)?;
        Ok(serde_json::json!({
            "sessionId": "claude-1-1",
            "authorizeUrl": "https://claude.ai/oauth/authorize?client_id=fake",
            "claudeVersion": "fake"
        }))
    }

    fn input_claude_setup_code(&self, workspace_id: &str, _session_id: &str) -> Result<()> {
        self.get(workspace_id)?;
        Ok(())
    }

    fn poll_claude_setup(
        &self,
        workspace_id: &str,
        _session_id: &str,
    ) -> Result<ClaudeSetupPollResponse> {
        self.get(workspace_id)?;
        Ok(ClaudeSetupPollResponse::Pending)
    }

    fn close_claude_setup(&self, workspace_id: &str, _session_id: &str) -> Result<()> {
        self.get(workspace_id)?;
        Ok(())
    }

    fn git_status(&self, workspace_id: &str, _worktree_id: Option<&str>) -> Result<String> {
        self.get(workspace_id)?;
        Ok("## main".into())
    }

    fn git_diff(&self, workspace_id: &str, _worktree_id: Option<&str>) -> Result<String> {
        self.get(workspace_id)?;
        Ok(String::new())
    }
}

#[cfg(test)]
mod tests {
    use chrono::Duration;

    use super::*;
    use crate::model::{SandboxLifecycleHooks, SandboxLifecycleOptions};

    fn create_request(workspace_id: &str) -> CreateRequest {
        CreateRequest {
            workspace_id: workspace_id.into(),
            ephemeral: false,
            hibernate_on_idle: false,
            repository_url: Some("https://github.com/yousef20920/CoDev.git".into()),
            repository_snapshot: None,
            base_sha: "fc1ba2947ffdaf8c1961e5342387e1079afface6".into(),
            expires_at: Utc::now() + Duration::hours(1),
            resume_from_snapshot: false,
            require_saved_state: false,
            persistent_disk_lun: None,
            lifecycle: SandboxLifecycleOptions {
                timeout_ms: 14_400_000,
                lifecycle: SandboxLifecycleHooks {
                    on_timeout: "pause".into(),
                    auto_resume: true,
                },
            },
        }
    }

    #[tokio::test]
    async fn fake_backend_allows_three_active_sessions_and_rejects_the_fourth() {
        let backend = Backend::fake();

        for index in 1..=MAX_ACTIVE_SESSIONS {
            backend
                .create(create_request(&format!("workspace-{index}")))
                .await
                .expect("active session within capacity");
        }

        assert_eq!(backend.active_count().await, MAX_ACTIVE_SESSIONS);
        assert!(matches!(
            backend.create(create_request("workspace-four")).await,
            Err(RuntimeError::CapacityExceeded)
        ));
    }

    #[tokio::test]
    async fn fake_backend_lifecycle() {
        let backend = Backend::fake();
        let request = create_request("e010bd2c-a3c1-438f-acef-166287a3b1cb");
        let instance = backend.create(request).await.expect("create");
        assert_eq!(backend.active_count().await, 1);
        assert_eq!(
            backend.get(&instance.workspace_id).await.expect("get").id,
            instance.id
        );
        backend
            .destroy(&instance.workspace_id)
            .await
            .expect("destroy");
        assert_eq!(backend.active_count().await, 0);
    }

    #[tokio::test]
    async fn host_shutdown_reservation_blocks_new_sandboxes_until_cancelled() {
        let backend = Backend::fake();
        assert!(backend.begin_host_shutdown_if_idle().await);
        assert!(matches!(
            backend.create(create_request("workspace")).await,
            Err(RuntimeError::Unavailable(_))
        ));

        backend.cancel_host_shutdown();
        backend
            .create(create_request("workspace"))
            .await
            .expect("create after cancelled shutdown");
        assert!(!backend.begin_host_shutdown_if_idle().await);
    }

    #[tokio::test]
    async fn fake_backend_reaps_expired_sandboxes() {
        let backend = Backend::fake();
        let mut expired = create_request("expired-workspace");
        expired.expires_at = Utc::now() - Duration::seconds(1);
        expired.ephemeral = true;
        backend
            .create(expired)
            .await
            .expect("create expired sandbox");
        backend
            .create(create_request("live-workspace"))
            .await
            .expect("create live sandbox");

        assert_eq!(backend.reap_expired().await, 1);
        assert!(matches!(
            backend.get("expired-workspace").await,
            Err(RuntimeError::SandboxNotFound)
        ));
        assert!(backend.get("live-workspace").await.is_ok());
    }

    #[tokio::test]
    async fn parked_ephemeral_reuses_its_vm_and_yields_capacity() {
        let backend = Backend::fake();
        let mut request = create_request("private-profile");
        request.ephemeral = true;
        let first = backend.create(request.clone()).await.expect("first boot");
        let parked = backend.park("private-profile").await.expect("park");
        let idle = (parked.expires_at - Utc::now()).num_seconds();
        assert!((175..=180).contains(&idle));

        request.expires_at = Utc::now() + Duration::minutes(10);
        let reused = backend.create(request).await.expect("reuse warm VM");
        assert_eq!(reused.id, first.id);
        assert!(reused.expires_at > parked.expires_at);

        backend.park("private-profile").await.expect("park again");
        for index in 1..MAX_ACTIVE_SESSIONS {
            backend
                .create(create_request(&format!("busy-{index}")))
                .await
                .expect("fill other slots");
        }
        backend
            .create(create_request("new-active"))
            .await
            .expect("new work reclaims parked slot");
        assert!(matches!(
            backend.get("private-profile").await,
            Err(RuntimeError::SandboxNotFound)
        ));
        assert_eq!(backend.active_count().await, MAX_ACTIVE_SESSIONS);
    }

    #[tokio::test]
    async fn durable_workspace_cannot_be_parked() {
        let backend = Backend::fake();
        backend
            .create(create_request("durable"))
            .await
            .expect("create durable workspace");
        assert!(matches!(
            backend.park("durable").await,
            Err(RuntimeError::BadRequest(_))
        ));
    }
}
