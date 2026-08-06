use std::{
    collections::HashMap,
    sync::{Arc, RwLock},
};

use chrono::{Duration, Utc};

use crate::model::{
    CreateRequest, ExecRequest, ExecResponse, FileResponse, Instance, PublicationExportRequest,
    PublicationExportResponse, Result, RuntimeError, TerminalInputRequest, TerminalPollRequest,
    TerminalPollResponse, TerminalResizeRequest, TerminalStartRequest, TheiaProxyRequest,
    TheiaProxyResponse, WorktreeCheckpointRequest, WorktreeCheckpointResponse,
    WorktreeCreateRequest, WorktreeMergeRequest, WorktreeMergeResponse, WorktreeRebaseRequest,
    WorktreeRebaseResponse, WorktreeReviewResponse, WriteFileRequest,
};

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

    pub async fn create_worktree(
        &self,
        workspace_id: &str,
        request: WorktreeCreateRequest,
    ) -> Result<()> {
        match self {
            Self::Fake(backend) => backend.create_worktree(workspace_id, request),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.create_worktree(workspace_id, request).await,
        }
    }

    pub async fn delete_worktree(&self, workspace_id: &str, worktree_id: &str) -> Result<()> {
        match self {
            Self::Fake(backend) => backend.delete_worktree(workspace_id, worktree_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.delete_worktree(workspace_id, worktree_id).await,
        }
    }

    pub async fn checkpoint_worktree(
        &self,
        workspace_id: &str,
        worktree_id: &str,
        request: WorktreeCheckpointRequest,
    ) -> Result<WorktreeCheckpointResponse> {
        match self {
            Self::Fake(backend) => backend.checkpoint_worktree(workspace_id, worktree_id, request),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => {
                backend
                    .checkpoint_worktree(workspace_id, worktree_id, request)
                    .await
            }
        }
    }

    pub async fn review_worktree(
        &self,
        workspace_id: &str,
        worktree_id: &str,
        base_sha: &str,
    ) -> Result<WorktreeReviewResponse> {
        match self {
            Self::Fake(backend) => backend.review_worktree(workspace_id, worktree_id, base_sha),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => {
                backend
                    .review_worktree(workspace_id, worktree_id, base_sha)
                    .await
            }
        }
    }

    pub async fn rebase_worktree(
        &self,
        workspace_id: &str,
        worktree_id: &str,
        request: WorktreeRebaseRequest,
    ) -> Result<WorktreeRebaseResponse> {
        match self {
            Self::Fake(backend) => backend.rebase_worktree(workspace_id, worktree_id, request),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => {
                backend
                    .rebase_worktree(workspace_id, worktree_id, request)
                    .await
            }
        }
    }

    pub async fn merge_worktree(
        &self,
        workspace_id: &str,
        worktree_id: &str,
        request: WorktreeMergeRequest,
    ) -> Result<WorktreeMergeResponse> {
        match self {
            Self::Fake(backend) => backend.merge_worktree(workspace_id, worktree_id, request),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => {
                backend
                    .merge_worktree(workspace_id, worktree_id, request)
                    .await
            }
        }
    }

    pub async fn export_publication(
        &self,
        workspace_id: &str,
        request: PublicationExportRequest,
    ) -> Result<PublicationExportResponse> {
        match self {
            Self::Fake(backend) => backend.export_publication(workspace_id, request),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.export_publication(workspace_id, request).await,
        }
    }

    pub async fn snapshot_workspace(
        &self,
        workspace_id: &str,
        request: PublicationExportRequest,
    ) -> Result<PublicationExportResponse> {
        match self {
            Self::Fake(backend) => backend.snapshot_workspace(workspace_id, request),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.snapshot_workspace(workspace_id, request).await,
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

    pub async fn proxy_theia(
        &self,
        workspace_id: &str,
        request: TheiaProxyRequest,
    ) -> Result<TheiaProxyResponse> {
        #[cfg(not(target_os = "linux"))]
        let _ = &request;
        match self {
            Self::Fake(backend) => backend.proxy_theia(workspace_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.proxy_theia(workspace_id, request).await,
        }
    }
}

pub type SharedBackend = Arc<Backend>;

pub struct FakeBackend {
    instances: RwLock<HashMap<String, Instance>>,
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
            max: 2,
        }
    }

    fn health(&self) -> Result<()> {
        Ok(())
    }

    fn active_count(&self) -> usize {
        self.instances.read().expect("fake backend lock").len()
    }

    fn create(&self, request: CreateRequest) -> Result<Instance> {
        let mut instances = self.instances.write().expect("fake backend lock");
        if let Some(instance) = instances.get(&request.workspace_id) {
            return Ok(instance.clone());
        }
        if instances.len() >= self.max {
            return Err(RuntimeError::CapacityExceeded);
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

    fn destroy(&self, workspace_id: &str) -> Result<()> {
        self.instances
            .write()
            .expect("fake backend lock")
            .remove(workspace_id)
            .map(|_| ())
            .ok_or(RuntimeError::SandboxNotFound)
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

    fn git_status(&self, workspace_id: &str, _worktree_id: Option<&str>) -> Result<String> {
        self.get(workspace_id)?;
        Ok("## main".into())
    }

    fn create_worktree(&self, workspace_id: &str, _request: WorktreeCreateRequest) -> Result<()> {
        self.get(workspace_id)?;
        Ok(())
    }

    fn delete_worktree(&self, workspace_id: &str, _worktree_id: &str) -> Result<()> {
        self.get(workspace_id)?;
        Ok(())
    }

    fn checkpoint_worktree(
        &self,
        workspace_id: &str,
        _worktree_id: &str,
        request: WorktreeCheckpointRequest,
    ) -> Result<WorktreeCheckpointResponse> {
        self.get(workspace_id)?;
        Ok(WorktreeCheckpointResponse {
            head_sha: request.expected_head_sha,
        })
    }

    fn review_worktree(
        &self,
        workspace_id: &str,
        _worktree_id: &str,
        base_sha: &str,
    ) -> Result<WorktreeReviewResponse> {
        self.get(workspace_id)?;
        Ok(WorktreeReviewResponse {
            base_sha: base_sha.into(),
            head_sha: base_sha.into(),
            diff: String::new(),
            diff_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".into(),
        })
    }

    fn rebase_worktree(
        &self,
        workspace_id: &str,
        _worktree_id: &str,
        request: WorktreeRebaseRequest,
    ) -> Result<WorktreeRebaseResponse> {
        self.get(workspace_id)?;
        Ok(WorktreeRebaseResponse {
            head_sha: request.expected_head_sha,
        })
    }

    fn merge_worktree(
        &self,
        workspace_id: &str,
        _worktree_id: &str,
        request: WorktreeMergeRequest,
    ) -> Result<WorktreeMergeResponse> {
        self.get(workspace_id)?;
        Ok(WorktreeMergeResponse {
            head_sha: request.expected_worktree_head_sha,
        })
    }

    fn export_publication(
        &self,
        workspace_id: &str,
        request: PublicationExportRequest,
    ) -> Result<PublicationExportResponse> {
        self.get(workspace_id)?;
        Ok(PublicationExportResponse {
            head_sha: request.expected_head_sha,
            files: Vec::new(),
            total_bytes: 0,
        })
    }

    fn snapshot_workspace(
        &self,
        workspace_id: &str,
        request: PublicationExportRequest,
    ) -> Result<PublicationExportResponse> {
        self.get(workspace_id)?;
        Ok(PublicationExportResponse {
            head_sha: request.expected_head_sha,
            files: Vec::new(),
            total_bytes: 0,
        })
    }

    fn git_diff(&self, workspace_id: &str, _worktree_id: Option<&str>) -> Result<String> {
        self.get(workspace_id)?;
        Ok(String::new())
    }

    fn proxy_theia(&self, workspace_id: &str) -> Result<TheiaProxyResponse> {
        self.get(workspace_id)?;
        Err(RuntimeError::Unavailable(
            "Theia is unavailable in the fake backend".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use chrono::Duration;

    use super::*;
    use crate::model::{SandboxLifecycleHooks, SandboxLifecycleOptions};

    #[tokio::test]
    async fn fake_backend_lifecycle() {
        let backend = Backend::fake();
        let request = CreateRequest {
            workspace_id: "e010bd2c-a3c1-438f-acef-166287a3b1cb".into(),
            repository_url: Some("https://github.com/yousef20920/CoDev.git".into()),
            repository_snapshot: None,
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
}
