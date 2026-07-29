use std::{
    collections::HashMap,
    sync::{Arc, RwLock},
};

use chrono::{DateTime, Utc};

use crate::model::{
    CreateRequest, ExecRequest, ExecResponse, FileResponse, Instance, Result, RuntimeError,
    TerminalInputRequest, TerminalPollRequest, TerminalPollResponse, TerminalResizeRequest,
    TerminalStartRequest, WriteFileRequest,
};

#[cfg(target_os = "linux")]
mod firecracker;
#[cfg(target_os = "linux")]
pub use firecracker::{FirecrackerBackend, FirecrackerConfig};

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

    pub async fn reap_idle(&self, cutoff: DateTime<Utc>) -> Result<Vec<String>> {
        match self {
            Self::Fake(backend) => backend.reap_idle(cutoff),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.reap_idle(cutoff).await,
        }
    }

    pub async fn read_file(&self, workspace_id: &str, path: String) -> Result<FileResponse> {
        match self {
            Self::Fake(backend) => backend.read_file(workspace_id, path),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.read_file(workspace_id, path).await,
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

    pub async fn git_status(&self, workspace_id: &str) -> Result<String> {
        match self {
            Self::Fake(backend) => backend.git_status(workspace_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.git_status(workspace_id).await,
        }
    }

    pub async fn git_diff(&self, workspace_id: &str) -> Result<String> {
        match self {
            Self::Fake(backend) => backend.git_diff(workspace_id),
            #[cfg(target_os = "linux")]
            Self::Firecracker(backend) => backend.git_diff(workspace_id).await,
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
        instance.last_activity_at = Utc::now();
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

    fn reap_idle(&self, cutoff: DateTime<Utc>) -> Result<Vec<String>> {
        let now = Utc::now();
        let mut instances = self.instances.write().expect("fake backend lock");
        let ids: Vec<_> = instances
            .iter()
            .filter(|(_, instance)| {
                instance.last_activity_at < cutoff || instance.expires_at <= now
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in &ids {
            instances.remove(id);
        }
        Ok(ids)
    }

    fn read_file(&self, workspace_id: &str, path: String) -> Result<FileResponse> {
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

    fn git_status(&self, workspace_id: &str) -> Result<String> {
        self.get(workspace_id)?;
        Ok("## main".into())
    }

    fn git_diff(&self, workspace_id: &str) -> Result<String> {
        self.get(workspace_id)?;
        Ok(String::new())
    }
}

#[cfg(test)]
mod tests {
    use chrono::Duration;

    use super::*;

    #[tokio::test]
    async fn fake_backend_lifecycle() {
        let backend = Backend::fake();
        let request = CreateRequest {
            workspace_id: "e010bd2c-a3c1-438f-acef-166287a3b1cb".into(),
            repository_url: "https://github.com/yousef20920/CoDev.git".into(),
            base_sha: "fc1ba2947ffdaf8c1961e5342387e1079afface6".into(),
            expires_at: Utc::now() + Duration::hours(1),
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
