use std::{
    collections::{HashMap, HashSet},
    fs::OpenOptions,
    io::ErrorKind,
    os::unix::fs::PermissionsExt,
    path::{Component, Path, PathBuf},
    process::Stdio,
    sync::{Arc, RwLock},
    time::{Duration, Instant},
};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncWriteExt},
    net::UnixStream,
    process::{Child, Command},
    sync::{Mutex, RwLock as AsyncRwLock},
    time::{sleep, timeout},
};
use tracing::{info, warn};

use crate::{
    guest_client::GuestClient,
    model::{
        CreateRequest, ExecRequest, ExecResponse, FileResponse, Instance, PublicationExportRequest,
        PublicationExportResponse, RepositorySnapshot, Result, RuntimeError, TerminalInputRequest,
        TerminalPollRequest, TerminalPollResponse, TerminalResizeRequest, TerminalStartRequest,
        WorktreeCheckpointRequest, WorktreeCheckpointResponse, WorktreeCreateRequest,
        WorktreeMergeRequest, WorktreeMergeResponse, WorktreeRebaseRequest, WorktreeRebaseResponse,
        WorktreeReviewResponse, WriteFileRequest,
    },
};

const GUEST_PORT: u32 = 52;

pub struct FirecrackerConfig {
    pub runtime_dir: PathBuf,
    pub kernel_image: PathBuf,
    pub rootfs_image: PathBuf,
    pub firecracker_bin: PathBuf,
    pub jailer_bin: PathBuf,
    pub jailer_dir: PathBuf,
    pub max_sandboxes: usize,
    pub vcpu_count: u8,
    pub memory_mib: u32,
    pub workspace_disk_gib: u8,
    pub idle_timeout: Duration,
}

impl FirecrackerConfig {
    pub fn from_environment() -> Result<Self> {
        let config = Self {
            runtime_dir: environment_path("CODEV_RUNTIME_DIR", "/var/lib/codev"),
            kernel_image: environment_path("CODEV_KERNEL_IMAGE", "/var/lib/codev/base/vmlinux"),
            rootfs_image: environment_path("CODEV_ROOTFS_IMAGE", "/var/lib/codev/base/rootfs.ext4"),
            firecracker_bin: environment_path(
                "CODEV_FIRECRACKER_BIN",
                "/usr/local/bin/firecracker",
            ),
            jailer_bin: environment_path("CODEV_JAILER_BIN", "/usr/local/bin/jailer"),
            jailer_dir: environment_path("CODEV_JAILER_DIR", "/srv/jailer"),
            max_sandboxes: environment_number("CODEV_MAX_SANDBOXES", 2)?,
            vcpu_count: environment_number("CODEV_VM_VCPU", 2)?,
            memory_mib: environment_number("CODEV_VM_MEMORY_MIB", 2048)?,
            workspace_disk_gib: environment_number("CODEV_VM_DISK_GIB", 10)?,
            idle_timeout: environment_duration(
                "CODEV_IDLE_TIMEOUT",
                Duration::from_secs(4 * 60 * 60),
            )?,
        };
        if !(1..=8).contains(&config.max_sandboxes) {
            return Err(RuntimeError::BadRequest(
                "CODEV_MAX_SANDBOXES must be between 1 and 8".into(),
            ));
        }
        if !(1..=8).contains(&config.vcpu_count) {
            return Err(RuntimeError::BadRequest(
                "CODEV_VM_VCPU must be between 1 and 8".into(),
            ));
        }
        if !(256..=8192).contains(&config.memory_mib) {
            return Err(RuntimeError::BadRequest(
                "CODEV_VM_MEMORY_MIB must be between 256 and 8192".into(),
            ));
        }
        if !(1..=20).contains(&config.workspace_disk_gib) {
            return Err(RuntimeError::BadRequest(
                "CODEV_VM_DISK_GIB must be between 1 and 20".into(),
            ));
        }
        if config.idle_timeout < Duration::from_secs(60)
            || config.idle_timeout > Duration::from_secs(4 * 60 * 60)
        {
            return Err(RuntimeError::BadRequest(
                "CODEV_IDLE_TIMEOUT must be between one minute and four hours".into(),
            ));
        }
        Ok(config)
    }
}

struct RunningMachine {
    instance: RwLock<Instance>,
    child: Mutex<Child>,
    guest: GuestClient,
    api_socket: PathBuf,
    workspace_dir: PathBuf,
    jail_dir: PathBuf,
    slot: u32,
}

impl RunningMachine {
    fn workspace_id(&self) -> String {
        self.instance
            .read()
            .expect("machine lock")
            .workspace_id
            .clone()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct MicroVmSnapshotMetadata {
    head_sha: String,
    slot: u32,
}

struct FirecrackerApiClient {
    socket_path: PathBuf,
}

impl FirecrackerApiClient {
    fn new(socket_path: PathBuf) -> Self {
        Self { socket_path }
    }

    async fn request(&self, method: &str, path: &str, payload: serde_json::Value) -> Result<()> {
        let body = serde_json::to_vec(&payload).map_err(RuntimeError::internal)?;
        let request = format!(
            "{method} {path} HTTP/1.1\r\nHost: localhost\r\nAccept: application/json\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let mut stream =
            UnixStream::connect(&self.socket_path)
                .await
                .map_err(|error| match error.kind() {
                    ErrorKind::NotFound | ErrorKind::ConnectionRefused => {
                        RuntimeError::Unavailable(format!(
                            "Firecracker API socket is not ready: {error}"
                        ))
                    }
                    _ => RuntimeError::internal(error),
                })?;
        stream
            .write_all(request.as_bytes())
            .await
            .map_err(RuntimeError::internal)?;
        stream
            .write_all(&body)
            .await
            .map_err(RuntimeError::internal)?;
        let mut response = Vec::new();
        timeout(Duration::from_secs(30), stream.read_to_end(&mut response))
            .await
            .map_err(|_| RuntimeError::Timeout("Firecracker API request timed out".into()))?
            .map_err(RuntimeError::internal)?;

        let header_end = response
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .ok_or_else(|| RuntimeError::Internal("invalid Firecracker API response".into()))?;
        let headers = String::from_utf8_lossy(&response[..header_end]);
        let status = headers
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|value| value.parse::<u16>().ok())
            .ok_or_else(|| RuntimeError::Internal("invalid Firecracker API status".into()))?;
        if !(200..300).contains(&status) {
            let body = String::from_utf8_lossy(&response[header_end + 4..]);
            return Err(RuntimeError::Internal(format!(
                "Firecracker API {method} {path} failed with HTTP {status}: {}",
                body.trim()
            )));
        }
        Ok(())
    }

    async fn pause(&self) -> Result<()> {
        self.request("PATCH", "/vm", json!({ "state": "Paused" }))
            .await
    }

    async fn create_full_snapshot(&self) -> Result<()> {
        self.request(
            "PUT",
            "/snapshot/create",
            json!({
                "snapshot_type": "Full",
                "snapshot_path": "/snapshot_file",
                "mem_file_path": "/mem_file"
            }),
        )
        .await
    }

    async fn load_snapshot(&self) -> Result<()> {
        self.request(
            "PUT",
            "/snapshot/load",
            json!({
                "snapshot_path": "/snapshot_file",
                "mem_backend": {
                    "backend_path": "/mem_file",
                    "backend_type": "File"
                },
                "vsock_override": { "uds_path": "/guest.vsock" },
                "resume_vm": true
            }),
        )
        .await
    }

    async fn resume(&self) -> Result<()> {
        self.request("PATCH", "/vm", json!({ "state": "Resumed" }))
            .await
    }
}

pub struct FirecrackerBackend {
    config: FirecrackerConfig,
    machines: AsyncRwLock<HashMap<String, Arc<RunningMachine>>>,
    provision: Mutex<()>,
}

impl FirecrackerBackend {
    pub async fn new(config: FirecrackerConfig) -> Result<Self> {
        let backend = Self {
            config,
            machines: AsyncRwLock::new(HashMap::new()),
            provision: Mutex::new(()),
        };
        backend.health().await?;
        let workspaces = backend.config.runtime_dir.join("workspaces");
        remove_directory_if_present(&workspaces).await?;
        fs::create_dir_all(&workspaces)
            .await
            .map_err(RuntimeError::internal)?;
        fs::set_permissions(&workspaces, std::fs::Permissions::from_mode(0o700))
            .await
            .map_err(RuntimeError::internal)?;
        let jails = backend.config.jailer_dir.join(
            backend
                .config
                .firecracker_bin
                .file_name()
                .ok_or_else(|| RuntimeError::Internal("invalid Firecracker path".into()))?,
        );
        remove_directory_if_present(&jails).await?;
        fs::create_dir_all(&backend.config.jailer_dir)
            .await
            .map_err(RuntimeError::internal)?;
        Ok(backend)
    }

    pub async fn health(&self) -> Result<()> {
        for (name, path) in [
            ("KVM device", Path::new("/dev/kvm")),
            ("kernel image", self.config.kernel_image.as_path()),
            ("rootfs image", self.config.rootfs_image.as_path()),
            ("Firecracker binary", self.config.firecracker_bin.as_path()),
            ("jailer binary", self.config.jailer_bin.as_path()),
        ] {
            if !path.exists() {
                return Err(RuntimeError::Unavailable(format!(
                    "{name} unavailable: {}",
                    path.display()
                )));
            }
        }
        OpenOptions::new()
            .read(true)
            .write(true)
            .open("/dev/kvm")
            .map_err(|error| {
                RuntimeError::Unavailable(format!(
                    "KVM device is not readable and writable: {error}"
                ))
            })?;
        Ok(())
    }

    pub async fn active_count(&self) -> usize {
        self.machines.read().await.len()
    }

    pub async fn create(&self, request: CreateRequest) -> Result<Instance> {
        let _guard = self.provision.lock().await;
        if let Some(machine) = self.machines.read().await.get(&request.workspace_id) {
            return Ok(machine.instance.read().expect("machine lock").clone());
        }
        if self.machines.read().await.len() >= self.config.max_sandboxes {
            return Err(RuntimeError::CapacityExceeded);
        }

        let machine = Arc::new(self.prepare_and_start(&request).await?);
        let instance = machine.instance.read().expect("machine lock").clone();
        self.machines
            .write()
            .await
            .insert(request.workspace_id, machine);
        Ok(instance)
    }

    pub async fn get(&self, workspace_id: &str) -> Result<Instance> {
        let machines = self.machines.read().await;
        machines
            .get(workspace_id)
            .map(|machine| machine.instance.read().expect("machine lock").clone())
            .ok_or(RuntimeError::SandboxNotFound)
    }

    pub async fn touch(&self, workspace_id: &str) -> Result<Instance> {
        let machines = self.machines.read().await;
        let machine = machines
            .get(workspace_id)
            .ok_or(RuntimeError::SandboxNotFound)?;
        let mut instance = machine.instance.write().expect("machine lock");
        let now = Utc::now();
        instance.last_activity_at = now;
        instance.expires_at = now
            + chrono::Duration::from_std(self.config.idle_timeout)
                .map_err(RuntimeError::internal)?;
        Ok(instance.clone())
    }

    pub async fn destroy(&self, workspace_id: &str) -> Result<()> {
        let _guard = self.provision.lock().await;
        let machine = self
            .machines
            .read()
            .await
            .get(workspace_id)
            .cloned()
            .ok_or(RuntimeError::SandboxNotFound)?;
        self.stop_machine(machine).await?;
        self.machines.write().await.remove(workspace_id);
        Ok(())
    }

    pub async fn resume(&self, workspace_id: &str) -> Result<()> {
        let machine = self.machine(workspace_id).await?;
        FirecrackerApiClient::new(machine.api_socket.clone())
            .resume()
            .await
    }

    pub async fn discard_snapshot(&self, workspace_id: &str) -> Result<()> {
        let _guard = self.provision.lock().await;
        remove_directory_if_present(&self.snapshot_dir(workspace_id)).await
    }

    pub async fn read_file(
        &self,
        workspace_id: &str,
        path: String,
        worktree_id: Option<&str>,
    ) -> Result<FileResponse> {
        let machine = self.machine(workspace_id).await?;
        let result = machine.guest.read_file(path, worktree_id).await?;
        self.mark_activity(&machine);
        Ok(result)
    }

    pub async fn write_file(
        &self,
        workspace_id: &str,
        request: WriteFileRequest,
    ) -> Result<String> {
        let machine = self.machine(workspace_id).await?;
        let result = machine.guest.write_file(&request).await?;
        self.mark_activity(&machine);
        Ok(result)
    }

    pub async fn exec(&self, workspace_id: &str, request: ExecRequest) -> Result<ExecResponse> {
        let machine = self.machine(workspace_id).await?;
        let result = machine.guest.exec(&request).await?;
        self.mark_activity(&machine);
        Ok(result)
    }

    pub async fn start_terminal(
        &self,
        workspace_id: &str,
        request: TerminalStartRequest,
    ) -> Result<String> {
        let machine = self.machine(workspace_id).await?;
        let result = machine.guest.start_terminal(&request).await?;
        self.mark_activity(&machine);
        Ok(result)
    }

    pub async fn input_terminal(
        &self,
        workspace_id: &str,
        session_id: &str,
        request: TerminalInputRequest,
    ) -> Result<()> {
        let machine = self.machine(workspace_id).await?;
        machine.guest.input_terminal(session_id, &request).await?;
        self.mark_activity(&machine);
        Ok(())
    }

    pub async fn resize_terminal(
        &self,
        workspace_id: &str,
        session_id: &str,
        request: TerminalResizeRequest,
    ) -> Result<()> {
        let machine = self.machine(workspace_id).await?;
        machine.guest.resize_terminal(session_id, &request).await?;
        self.mark_activity(&machine);
        Ok(())
    }

    pub async fn poll_terminal(
        &self,
        workspace_id: &str,
        session_id: &str,
        request: TerminalPollRequest,
    ) -> Result<TerminalPollResponse> {
        let machine = self.machine(workspace_id).await?;
        let result = machine.guest.poll_terminal(session_id, &request).await?;
        self.mark_activity(&machine);
        Ok(result)
    }

    pub async fn close_terminal(&self, workspace_id: &str, session_id: &str) -> Result<()> {
        let machine = self.machine(workspace_id).await?;
        machine.guest.close_terminal(session_id).await?;
        self.mark_activity(&machine);
        Ok(())
    }

    pub async fn create_worktree(
        &self,
        workspace_id: &str,
        request: WorktreeCreateRequest,
    ) -> Result<()> {
        let machine = self.machine(workspace_id).await?;
        machine.guest.create_worktree(&request).await?;
        self.mark_activity(&machine);
        Ok(())
    }

    pub async fn delete_worktree(&self, workspace_id: &str, worktree_id: &str) -> Result<()> {
        let machine = self.machine(workspace_id).await?;
        machine.guest.delete_worktree(worktree_id).await?;
        self.mark_activity(&machine);
        Ok(())
    }

    pub async fn checkpoint_worktree(
        &self,
        workspace_id: &str,
        worktree_id: &str,
        request: WorktreeCheckpointRequest,
    ) -> Result<WorktreeCheckpointResponse> {
        let machine = self.machine(workspace_id).await?;
        let result = machine
            .guest
            .checkpoint_worktree(worktree_id, &request)
            .await?;
        self.mark_activity(&machine);
        Ok(result)
    }

    pub async fn review_worktree(
        &self,
        workspace_id: &str,
        worktree_id: &str,
        base_sha: &str,
    ) -> Result<WorktreeReviewResponse> {
        let machine = self.machine(workspace_id).await?;
        let result = machine.guest.review_worktree(worktree_id, base_sha).await?;
        self.mark_activity(&machine);
        Ok(result)
    }

    pub async fn rebase_worktree(
        &self,
        workspace_id: &str,
        worktree_id: &str,
        request: WorktreeRebaseRequest,
    ) -> Result<WorktreeRebaseResponse> {
        let machine = self.machine(workspace_id).await?;
        let result = machine.guest.rebase_worktree(worktree_id, &request).await?;
        self.mark_activity(&machine);
        Ok(result)
    }

    pub async fn merge_worktree(
        &self,
        workspace_id: &str,
        worktree_id: &str,
        request: WorktreeMergeRequest,
    ) -> Result<WorktreeMergeResponse> {
        let machine = self.machine(workspace_id).await?;
        let result = machine.guest.merge_worktree(worktree_id, &request).await?;
        self.mark_activity(&machine);
        Ok(result)
    }

    pub async fn export_publication(
        &self,
        workspace_id: &str,
        request: PublicationExportRequest,
    ) -> Result<PublicationExportResponse> {
        let machine = self.machine(workspace_id).await?;
        let result = machine.guest.export_publication(&request).await?;
        self.mark_activity(&machine);
        Ok(result)
    }

    pub async fn snapshot_workspace(
        &self,
        workspace_id: &str,
        request: PublicationExportRequest,
    ) -> Result<PublicationExportResponse> {
        let machine = self.machine(workspace_id).await?;
        let result = machine.guest.snapshot_workspace(&request).await?;
        self.snapshot_machine(&machine, &result.head_sha).await?;
        Ok(result)
    }

    pub async fn git_status(
        &self,
        workspace_id: &str,
        worktree_id: Option<&str>,
    ) -> Result<String> {
        let machine = self.machine(workspace_id).await?;
        let result = machine.guest.git_status(worktree_id).await?;
        self.mark_activity(&machine);
        Ok(result)
    }

    pub async fn git_diff(&self, workspace_id: &str, worktree_id: Option<&str>) -> Result<String> {
        let machine = self.machine(workspace_id).await?;
        let result = machine.guest.git_diff(worktree_id).await?;
        self.mark_activity(&machine);
        Ok(result)
    }

    async fn machine(&self, workspace_id: &str) -> Result<Arc<RunningMachine>> {
        let machine = self
            .machines
            .read()
            .await
            .get(workspace_id)
            .cloned()
            .ok_or(RuntimeError::SandboxNotFound)?;
        let exited = machine
            .child
            .lock()
            .await
            .try_wait()
            .map_err(RuntimeError::internal)?
            .is_some();
        if exited {
            self.machines.write().await.remove(workspace_id);
            self.cleanup_failed_machine(&machine).await;
            return Err(RuntimeError::SandboxNotFound);
        }
        Ok(machine)
    }

    fn mark_activity(&self, machine: &RunningMachine) {
        machine
            .instance
            .write()
            .expect("machine lock")
            .last_activity_at = Utc::now();
    }

    fn snapshot_dir(&self, workspace_id: &str) -> PathBuf {
        self.config.jailer_dir.join("snapshots").join(workspace_id)
    }

    async fn snapshot_metadata(
        &self,
        workspace_id: &str,
    ) -> Result<Option<MicroVmSnapshotMetadata>> {
        let directory = self.snapshot_dir(workspace_id);
        let metadata_path = directory.join("metadata.json");
        let metadata = match fs::read(&metadata_path).await {
            Ok(contents) => serde_json::from_slice(&contents).map_err(|error| {
                RuntimeError::Internal(format!(
                    "invalid Firecracker snapshot metadata for {workspace_id}: {error}"
                ))
            })?,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(RuntimeError::internal(error)),
        };
        for name in ["snapshot_file", "mem_file", "rootfs.ext4", "workspace.ext4"] {
            if !directory.join(name).is_file() {
                return Err(RuntimeError::Unavailable(format!(
                    "Firecracker snapshot for {workspace_id} is incomplete"
                )));
            }
        }
        Ok(Some(metadata))
    }

    async fn snapshot_machine(&self, machine: &RunningMachine, head_sha: &str) -> Result<()> {
        let started_at = Instant::now();
        let api = FirecrackerApiClient::new(machine.api_socket.clone());
        api.pause().await?;
        if let Err(error) = api.create_full_snapshot().await {
            let _ = api
                .request("PATCH", "/vm", json!({ "state": "Resumed" }))
                .await;
            return Err(error);
        }

        let snapshots_root = self.config.jailer_dir.join("snapshots");
        let staging = snapshots_root.join(format!(".{}.next", machine.workspace_id()));
        let files = [
            ("snapshot_file", machine.jail_dir.join("root/snapshot_file")),
            ("mem_file", machine.jail_dir.join("root/mem_file")),
            ("rootfs.ext4", machine.jail_dir.join("root/rootfs.ext4")),
            (
                "workspace.ext4",
                machine.jail_dir.join("root/workspace.ext4"),
            ),
        ];
        let persist_result = async {
            fs::create_dir_all(&snapshots_root)
                .await
                .map_err(RuntimeError::internal)?;
            remove_directory_if_present(&staging).await?;
            fs::create_dir_all(&staging)
                .await
                .map_err(RuntimeError::internal)?;
            for (name, source) in files {
                link_or_copy(&source, &staging.join(name)).await?;
            }
            let metadata = serde_json::to_vec(&MicroVmSnapshotMetadata {
                head_sha: head_sha.to_owned(),
                slot: machine.slot,
            })
            .map_err(RuntimeError::internal)?;
            fs::write(staging.join("metadata.json"), metadata)
                .await
                .map_err(RuntimeError::internal)?;
            let destination = self.snapshot_dir(&machine.workspace_id());
            remove_directory_if_present(&destination).await?;
            fs::rename(&staging, &destination)
                .await
                .map_err(RuntimeError::internal)?;
            Ok::<(), RuntimeError>(())
        }
        .await;
        if let Err(error) = persist_result {
            let _ = api
                .request("PATCH", "/vm", json!({ "state": "Resumed" }))
                .await;
            let _ = remove_directory_if_present(&staging).await;
            return Err(error);
        }
        info!(
            workspace_id = %machine.workspace_id(),
            snapshot_ms = started_at.elapsed().as_millis() as u64,
            "firecracker snapshot persisted"
        );
        Ok(())
    }

    async fn prepare_and_start(&self, request: &CreateRequest) -> Result<RunningMachine> {
        let snapshot_metadata = if request.resume_from_snapshot {
            self.snapshot_metadata(&request.workspace_id).await?
        } else {
            None
        };
        let restore_snapshot = snapshot_metadata.is_some();
        let slot = {
            let machines = self.machines.read().await;
            if let Some(metadata) = snapshot_metadata.as_ref() {
                if metadata.slot >= self.config.max_sandboxes as u32
                    || machines
                        .values()
                        .any(|machine| machine.slot == metadata.slot)
                {
                    return Err(RuntimeError::CapacityExceeded);
                }
                metadata.slot
            } else {
                first_available_slot(
                    machines.values().map(|machine| machine.slot),
                    self.config.max_sandboxes,
                )
                .ok_or(RuntimeError::CapacityExceeded)?
            }
        };
        let uid = 20_000 + slot;
        let guest_cid = 3 + slot;
        let id = request.workspace_id.replace('-', "");
        let workspace_dir = self
            .config
            .runtime_dir
            .join("workspaces")
            .join(&request.workspace_id);
        remove_directory_if_present(&workspace_dir).await?;
        fs::create_dir_all(&workspace_dir)
            .await
            .map_err(RuntimeError::internal)?;
        fs::set_permissions(&workspace_dir, std::fs::Permissions::from_mode(0o700))
            .await
            .map_err(RuntimeError::internal)?;

        let firecracker_name = self
            .config
            .firecracker_bin
            .file_name()
            .ok_or_else(|| RuntimeError::Internal("invalid Firecracker path".into()))?;
        let jail_dir = self.config.jailer_dir.join(firecracker_name).join(&id);
        remove_directory_if_present(&jail_dir).await?;
        let jail_root = jail_dir.join("root");
        fs::create_dir_all(&jail_root)
            .await
            .map_err(RuntimeError::internal)?;

        let head_sha = match if restore_snapshot {
            self.prepare_snapshot_resources(
                &self.snapshot_dir(&request.workspace_id),
                &jail_root,
                uid,
            )
            .await
            .map(|_| {
                snapshot_metadata
                    .as_ref()
                    .expect("snapshot metadata")
                    .head_sha
                    .clone()
            })
        } else {
            self.prepare_resources(request, &workspace_dir, &jail_root, guest_cid)
                .await
        } {
            Ok(head_sha) => head_sha,
            Err(error) => {
                let _ = remove_directory_if_present(&workspace_dir).await;
                let _ = remove_directory_if_present(&jail_dir).await;
                return Err(error);
            }
        };

        let mut paths = vec![
            jail_root.join("rootfs.ext4"),
            jail_root.join("workspace.ext4"),
        ];
        if !restore_snapshot {
            paths.push(jail_root.join("vmlinux"));
            paths.push(jail_root.join("config.json"));
        } else {
            paths.push(jail_root.join("snapshot_file"));
            paths.push(jail_root.join("mem_file"));
        }
        let mut chown = Command::new("chown");
        chown.arg(format!("{uid}:{uid}")).args(&paths);
        run_command(chown, "chown jail resources").await?;
        for path in &paths {
            fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
                .await
                .map_err(RuntimeError::internal)?;
        }
        if !restore_snapshot {
            fs::set_permissions(
                jail_root.join("vmlinux"),
                std::fs::Permissions::from_mode(0o644),
            )
            .await
            .map_err(RuntimeError::internal)?;
        }

        let mut command = Command::new(&self.config.jailer_bin);
        command
            .arg("--id")
            .arg(&id)
            .arg("--exec-file")
            .arg(&self.config.firecracker_bin)
            .arg("--uid")
            .arg(uid.to_string())
            .arg("--gid")
            .arg(uid.to_string())
            .arg("--chroot-base-dir")
            .arg(&self.config.jailer_dir)
            .arg("--cgroup-version")
            .arg("2")
            .arg("--resource-limit")
            .arg("no-file=4096")
            .arg("--")
            .arg("--api-sock")
            .arg("/api.socket");
        if !restore_snapshot {
            command.arg("--config-file").arg("/config.json");
        }
        command
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .kill_on_drop(true);
        let child = command.spawn().map_err(RuntimeError::internal)?;
        let guest = GuestClient::new(jail_root.join("guest.vsock"), GUEST_PORT);
        let api_socket = jail_root.join("api.socket");
        let machine = RunningMachine {
            instance: RwLock::new(Instance {
                id: format!("fc-{id}"),
                workspace_id: request.workspace_id.clone(),
                status: "ready".into(),
                head_sha,
                created_at: Utc::now(),
                last_activity_at: Utc::now(),
                expires_at: request.expires_at,
            }),
            child: Mutex::new(child),
            guest,
            api_socket,
            workspace_dir,
            jail_dir,
            slot,
        };

        if restore_snapshot {
            let restore_started_at = Instant::now();
            let restore = timeout(Duration::from_secs(45), async {
                loop {
                    match FirecrackerApiClient::new(machine.api_socket.clone())
                        .load_snapshot()
                        .await
                    {
                        Ok(()) => break Ok(()),
                        Err(RuntimeError::Unavailable(_)) => {
                            sleep(Duration::from_millis(100)).await
                        }
                        Err(error) => break Err(error),
                    }
                }
            })
            .await;
            match restore {
                Ok(Ok(())) => {
                    let restore_ms = restore_started_at.elapsed().as_millis() as u64;
                    if restore_ms > 500 {
                        warn!(
                            workspace_id = %request.workspace_id,
                            restore_ms,
                            target_ms = 500,
                            "firecracker snapshot restore exceeded target"
                        );
                    } else {
                        info!(
                            workspace_id = %request.workspace_id,
                            restore_ms,
                            "firecracker snapshot restored"
                        );
                    }
                }
                Ok(Err(error)) => {
                    self.cleanup_failed_machine(&machine).await;
                    return Err(error);
                }
                Err(_) => {
                    self.cleanup_failed_machine(&machine).await;
                    return Err(RuntimeError::Timeout(
                        "Firecracker snapshot restore timed out".into(),
                    ));
                }
            }
        }

        let ready = timeout(Duration::from_secs(45), async {
            loop {
                if let Some(status) = machine
                    .child
                    .lock()
                    .await
                    .try_wait()
                    .map_err(RuntimeError::internal)?
                {
                    return Err(RuntimeError::Unavailable(format!(
                        "Firecracker exited before guest readiness: {status}"
                    )));
                }
                if machine.guest.health().await.is_ok() {
                    return Ok(());
                }
                sleep(Duration::from_millis(250)).await;
            }
        })
        .await;
        match ready {
            Ok(Ok(())) => {
                if restore_snapshot {
                    remove_directory_if_present(&self.snapshot_dir(&request.workspace_id)).await?;
                }
                Ok(machine)
            }
            Ok(Err(error)) => {
                self.cleanup_failed_machine(&machine).await;
                Err(error)
            }
            Err(_) => {
                self.cleanup_failed_machine(&machine).await;
                Err(RuntimeError::Unavailable(
                    "guest daemon did not become ready".into(),
                ))
            }
        }
    }

    async fn prepare_resources(
        &self,
        request: &CreateRequest,
        workspace_dir: &Path,
        jail_root: &Path,
        guest_cid: u32,
    ) -> Result<String> {
        let repository = workspace_dir.join("repository");
        let mut init = Command::new("git");
        init.arg("init").arg("--quiet").arg(&repository);
        run_command(init, "initialize repository").await?;
        let head_sha = if let Some(repository_url) = &request.repository_url {
            let mut remote = Command::new("git");
            remote
                .arg("-C")
                .arg(&repository)
                .args(["remote", "add", "origin"])
                .arg(repository_url);
            run_command(remote, "configure repository remote").await?;
            let mut fetch = Command::new("git");
            fetch
                .arg("-C")
                .arg(&repository)
                .args(["fetch", "--quiet", "--depth=1", "origin"])
                .arg(&request.base_sha);
            run_command(fetch, "fetch repository revision").await?;
            let mut checkout = Command::new("git");
            checkout.arg("-C").arg(&repository).args([
                "checkout",
                "--quiet",
                "--detach",
                "FETCH_HEAD",
            ]);
            run_command(checkout, "checkout repository revision").await?;
            request.base_sha.clone()
        } else {
            let snapshot = request.repository_snapshot.as_ref().ok_or_else(|| {
                RuntimeError::BadRequest("repository snapshot is required".into())
            })?;
            materialize_snapshot(&repository, snapshot).await?
        };

        let workspace_disk = jail_root.join("workspace.ext4");
        let mut truncate = Command::new("truncate");
        truncate
            .arg("-s")
            .arg(format!("{}G", self.config.workspace_disk_gib))
            .arg(&workspace_disk);
        run_command(truncate, "allocate workspace disk").await?;
        let mut mkfs = Command::new("mkfs.ext4");
        mkfs.args(["-q", "-F", "-d"])
            .arg(&repository)
            .args(["-L", "CODEV_WORKSPACE"])
            .arg(&workspace_disk);
        run_command(mkfs, "format workspace disk").await?;
        fs::remove_dir_all(&repository)
            .await
            .map_err(RuntimeError::internal)?;

        let mut copy = Command::new("cp");
        copy.args(["--reflink=auto", "--sparse=always"])
            .arg(&self.config.rootfs_image)
            .arg(jail_root.join("rootfs.ext4"));
        run_command(copy, "copy guest rootfs").await?;
        fs::copy(&self.config.kernel_image, jail_root.join("vmlinux"))
            .await
            .map_err(RuntimeError::internal)?;

        let config = json!({
            "boot-source": {
                "kernel_image_path": "/vmlinux",
                "boot_args": "keep_bootcon console=ttyS0 reboot=k panic=1 pci=off root=/dev/vda rw"
            },
            "drives": [
                {
                    "drive_id": "rootfs",
                    "path_on_host": "/rootfs.ext4",
                    "is_root_device": true,
                    "is_read_only": false
                },
                {
                    "drive_id": "workspace",
                    "path_on_host": "/workspace.ext4",
                    "is_root_device": false,
                    "is_read_only": false
                }
            ],
            "machine-config": {
                "vcpu_count": self.config.vcpu_count,
                "mem_size_mib": self.config.memory_mib,
                "smt": false
            },
            "vsock": {
                "guest_cid": guest_cid,
                "uds_path": "/guest.vsock"
            }
        });
        fs::write(
            jail_root.join("config.json"),
            serde_json::to_vec(&config).map_err(RuntimeError::internal)?,
        )
        .await
        .map_err(RuntimeError::internal)?;
        Ok(head_sha)
    }

    async fn prepare_snapshot_resources(
        &self,
        snapshot_dir: &Path,
        jail_root: &Path,
        uid: u32,
    ) -> Result<()> {
        // Firecracker maps the memory snapshot read-only and releases the VM
        // state snapshot after loading. Hard-linking these immutable files
        // avoids copying guest RAM during the sub-second restore path.
        for name in ["snapshot_file", "mem_file"] {
            link_or_copy(&snapshot_dir.join(name), &jail_root.join(name)).await?;
        }
        // The guest can write both block devices after resume, so they must
        // not share inodes with the durable recovery snapshot.
        for name in ["rootfs.ext4", "workspace.ext4"] {
            clone_or_copy(&snapshot_dir.join(name), &jail_root.join(name)).await?;
        }
        let mut chown = Command::new("chown");
        chown.arg(format!("{uid}:{uid}")).args([
            jail_root.join("snapshot_file"),
            jail_root.join("mem_file"),
            jail_root.join("rootfs.ext4"),
            jail_root.join("workspace.ext4"),
        ]);
        run_command(chown, "chown snapshot resources").await
    }

    async fn cleanup_failed_machine(&self, machine: &RunningMachine) {
        let _ = machine.child.lock().await.kill().await;
        let _ = machine.child.lock().await.wait().await;
        let _ = remove_directory_if_present(&machine.jail_dir).await;
        let _ = remove_directory_if_present(&machine.workspace_dir).await;
    }

    async fn stop_machine(&self, machine: Arc<RunningMachine>) -> Result<()> {
        {
            let mut child = machine.child.lock().await;
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        remove_directory_if_present(&machine.jail_dir).await?;
        remove_directory_if_present(&machine.workspace_dir).await
    }
}

async fn run_command(mut command: Command, description: &str) -> Result<()> {
    let output = timeout(Duration::from_secs(90), command.output())
        .await
        .map_err(|_| RuntimeError::Timeout(format!("{description} timed out")))?
        .map_err(RuntimeError::internal)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(RuntimeError::Internal(format!(
            "{description} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )))
    }
}

async fn run_command_stdout(mut command: Command, description: &str) -> Result<String> {
    let output = timeout(Duration::from_secs(90), command.output())
        .await
        .map_err(|_| RuntimeError::Timeout(format!("{description} timed out")))?
        .map_err(RuntimeError::internal)?;
    if !output.status.success() {
        return Err(RuntimeError::Internal(format!(
            "{description} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn safe_snapshot_path(value: &str) -> Result<&Path> {
    if value.is_empty() || value.len() > 4_096 || value.contains('\0') {
        return Err(RuntimeError::BadRequest(
            "repository snapshot contains an invalid path".into(),
        ));
    }
    let path = Path::new(value);
    if path.is_absolute()
        || path.components().any(|component| match component {
            Component::Normal(segment) => segment.eq_ignore_ascii_case(".git"),
            _ => true,
        })
    {
        return Err(RuntimeError::BadRequest(
            "repository snapshot contains an unsafe path".into(),
        ));
    }
    Ok(path)
}

async fn materialize_snapshot(repository: &Path, snapshot: &RepositorySnapshot) -> Result<String> {
    let mut paths = HashSet::new();
    let mut total_bytes = 0usize;
    for file in &snapshot.files {
        let relative_path = safe_snapshot_path(&file.path)?;
        if !paths.insert(file.path.clone()) {
            return Err(RuntimeError::BadRequest(
                "repository snapshot contains duplicate paths".into(),
            ));
        }
        let contents = BASE64
            .decode(&file.content_base64)
            .map_err(|_| RuntimeError::BadRequest("invalid snapshot base64".into()))?;
        total_bytes = total_bytes
            .checked_add(contents.len())
            .ok_or_else(|| RuntimeError::BadRequest("snapshot size overflow".into()))?;
        if contents.len() > 1_024 * 1_024 || total_bytes > 3 * 1_024 * 1_024 {
            return Err(RuntimeError::BadRequest(
                "repository snapshot exceeds its size limit".into(),
            ));
        }
        let destination = repository.join(relative_path);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(RuntimeError::internal)?;
        }
        match file.mode.as_str() {
            "100644" | "100755" => {
                fs::write(&destination, contents)
                    .await
                    .map_err(RuntimeError::internal)?;
                if file.mode == "100755" {
                    fs::set_permissions(&destination, std::fs::Permissions::from_mode(0o755))
                        .await
                        .map_err(RuntimeError::internal)?;
                }
            }
            "120000" => {
                let target = String::from_utf8(contents)
                    .map_err(|_| RuntimeError::BadRequest("invalid symlink target".into()))?;
                fs::symlink(target, &destination)
                    .await
                    .map_err(RuntimeError::internal)?;
            }
            _ => {
                return Err(RuntimeError::BadRequest(
                    "repository snapshot contains an unsupported file mode".into(),
                ));
            }
        }
    }
    if total_bytes != snapshot.total_bytes {
        return Err(RuntimeError::BadRequest(
            "repository snapshot size does not match its contents".into(),
        ));
    }

    for (key, value) in [
        ("user.name", "CoDev Snapshot"),
        ("user.email", "snapshot@codev.invalid"),
    ] {
        let mut config = Command::new("git");
        config
            .arg("-C")
            .arg(repository)
            .args(["config", key, value]);
        run_command(config, "configure snapshot repository").await?;
    }
    let mut add = Command::new("git");
    add.arg("-C").arg(repository).args(["add", "--all"]);
    run_command(add, "stage repository snapshot").await?;
    let mut commit = Command::new("git");
    commit.arg("-C").arg(repository).args([
        "commit",
        "--quiet",
        "--no-gpg-sign",
        "--allow-empty",
        "-m",
        "Import private repository snapshot",
    ]);
    run_command(commit, "commit repository snapshot").await?;
    let mut head = Command::new("git");
    head.arg("-C").arg(repository).args(["rev-parse", "HEAD"]);
    let head_sha = run_command_stdout(head, "read snapshot revision").await?;
    if head_sha.len() != 40 || !head_sha.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(RuntimeError::Internal(
            "snapshot repository returned an invalid revision".into(),
        ));
    }
    Ok(head_sha)
}

async fn remove_directory_if_present(path: &Path) -> Result<()> {
    match fs::remove_dir_all(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(RuntimeError::internal(error)),
    }
}

async fn link_or_copy(source: &Path, destination: &Path) -> Result<()> {
    match fs::hard_link(source, destination).await {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(source, destination)
                .await
                .map_err(RuntimeError::internal)?;
            Ok(())
        }
    }
}

/// Restore writable VM resources without hard-linking them to the durable
/// snapshot. A resumed guest can mutate its disk images; a filesystem reflink
/// keeps a failed restore from corrupting the only recovery artifact without
/// copying multi-GiB block devices. AWS provisions `/srv/jailer` as XFS with
/// reflinks enabled; fail rather than silently taking a slow full-copy path on
/// an incorrectly configured host.
async fn clone_or_copy(source: &Path, destination: &Path) -> Result<()> {
    let output = Command::new("cp")
        .args(["--reflink=always", "--sparse=always"])
        .arg(source)
        .arg(destination)
        .output()
        .await
        .map_err(RuntimeError::internal)?;
    if output.status.success() {
        return Ok(());
    }
    Err(RuntimeError::Unavailable(format!(
        "snapshot storage does not support reflink restore: {}",
        String::from_utf8_lossy(&output.stderr).trim()
    )))
}

fn first_available_slot(
    occupied: impl IntoIterator<Item = u32>,
    max_sandboxes: usize,
) -> Option<u32> {
    let occupied = occupied
        .into_iter()
        .collect::<std::collections::HashSet<_>>();
    (0..max_sandboxes as u32).find(|slot| !occupied.contains(slot))
}

fn environment_path(name: &str, fallback: &str) -> PathBuf {
    std::env::var_os(name)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(fallback))
}

fn environment_number<T>(name: &str, fallback: T) -> Result<T>
where
    T: std::str::FromStr,
    T::Err: std::fmt::Display,
{
    match std::env::var(name) {
        Ok(value) => value
            .parse()
            .map_err(|error| RuntimeError::BadRequest(format!("parse {name}: {error}"))),
        Err(std::env::VarError::NotPresent) => Ok(fallback),
        Err(error) => Err(RuntimeError::BadRequest(format!("read {name}: {error}"))),
    }
}

fn environment_duration(name: &str, fallback: Duration) -> Result<Duration> {
    match std::env::var(name) {
        Ok(value) => parse_duration(&value)
            .ok_or_else(|| RuntimeError::BadRequest(format!("parse {name}: invalid duration"))),
        Err(std::env::VarError::NotPresent) => Ok(fallback),
        Err(error) => Err(RuntimeError::BadRequest(format!("read {name}: {error}"))),
    }
}

pub fn parse_duration(value: &str) -> Option<Duration> {
    let (number, multiplier) = if let Some(value) = value.strip_suffix("ms") {
        (value, 1)
    } else if let Some(value) = value.strip_suffix('s') {
        (value, 1_000)
    } else if let Some(value) = value.strip_suffix('m') {
        (value, 60_000)
    } else {
        (value.strip_suffix('h')?, 3_600_000)
    };
    number
        .parse::<u64>()
        .ok()
        .and_then(|number| number.checked_mul(multiplier))
        .map(Duration::from_millis)
}

#[cfg(test)]
mod tests {
    use super::{first_available_slot, parse_duration};

    #[test]
    fn parses_runtime_durations() {
        assert_eq!(parse_duration("15m").expect("duration").as_secs(), 900);
        assert_eq!(parse_duration("4h").expect("duration").as_secs(), 14_400);
        assert!(parse_duration("soon").is_none());
    }

    #[test]
    fn allocates_unique_slots_during_churn() {
        assert_eq!(first_available_slot([0, 1], 3), Some(2));
        assert_eq!(first_available_slot([1], 3), Some(0));
        assert_eq!(first_available_slot([0, 1], 2), None);
    }
}
