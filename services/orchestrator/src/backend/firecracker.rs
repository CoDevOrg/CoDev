use std::{
    collections::{HashMap, HashSet},
    fs::OpenOptions,
    io::ErrorKind,
    os::unix::fs::PermissionsExt,
    path::{Component, Path, PathBuf},
    process::Stdio,
    sync::{
        Arc, RwLock,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
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
        ClaudeSetupCodeRequest, ClaudeSetupPollRequest, ClaudeSetupPollResponse,
        ClaudeSetupStartRequest, CodexExecPollRequest, CodexExecPollResponse,
        CodexExecStartRequest, CreateRequest, ExecRequest, ExecResponse, FileResponse, Instance,
        PublicationExportRequest, PublicationExportResponse, RepositorySnapshot, Result,
        RuntimeError, SessionRestoreBeginRequest, SessionRestoreChunkRequest,
        SessionRestoreFinalizeResponse, TerminalInputRequest, TerminalPollRequest,
        TerminalPollResponse, TerminalResizeRequest, TerminalStartRequest,
        WorktreeCheckpointRequest, WorktreeCheckpointResponse, WorktreeCreateRequest,
        WorktreeMergeRequest, WorktreeMergeResponse, WorktreeRebaseRequest, WorktreeRebaseResponse,
        WorktreeReviewResponse, WriteFileRequest,
    },
};

const GUEST_PORT: u32 = 52;

/// Firecracker reserves CIDs 0-2, so guest CIDs start here and the slot index
/// is recoverable as `guest_cid - GUEST_CID_BASE`.
const GUEST_CID_BASE: u32 = 3;

/// Each slot gets its own /30 out of 10.200.0.0/16: `.1` on the host tap,
/// `.2` in the guest. A /30 is the smallest subnet that carries both, so two
/// guests can never address each other -- the only route out of a guest is the
/// host, where codev-firecracker-network-isolation filters what may leave.
const GUEST_NETMASK: &str = "255.255.255.252";

fn tap_name(slot: usize) -> String {
    format!("codev-tap{slot}")
}

fn host_ip(slot: usize) -> String {
    format!("10.200.{slot}.1")
}

fn guest_ip(slot: usize) -> String {
    format!("10.200.{slot}.2")
}

/// Create (or re-create) the tap backing a slot's guest NIC.
///
/// Called before every launch, including a snapshot restore: a restored VM
/// keeps the slot recorded in its snapshot metadata, so it comes back to a tap
/// of the same name, which is what Firecracker requires to reattach the
/// device. The interface is torn down with the machine, so `add` normally
/// starts from nothing; the delete first keeps a leaked tap from a hard crash
/// from failing the next boot with EEXIST.
async fn ensure_tap(slot: usize) -> Result<()> {
    let name = tap_name(slot);
    remove_tap(slot).await;
    let mut add = Command::new("ip");
    add.args(["tuntap", "add", "dev", &name, "mode", "tap"]);
    run_command(add, "create guest tap").await?;
    let mut address = Command::new("ip");
    address.args([
        "addr",
        "add",
        &format!("{}/30", host_ip(slot)),
        "dev",
        &name,
    ]);
    run_command(address, "address guest tap").await?;
    let mut up = Command::new("ip");
    up.args(["link", "set", "dev", &name, "up"]);
    run_command(up, "bring up guest tap").await?;
    Ok(())
}

/// Best-effort teardown. A tap that outlives its machine would keep an address
/// bound and block the slot's next boot, but failing a destroy over it would
/// strand the sandbox instead, so this only warns.
async fn remove_tap(slot: usize) {
    let name = tap_name(slot);
    let mut delete = Command::new("ip");
    delete
        .args(["link", "del", &name])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    match delete.status().await {
        Ok(_) => {}
        Err(error) => warn!(tap = %name, %error, "failed to remove guest tap"),
    }
}

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
    /// Whether guests get a NAT'd tap interface. Off leaves them with only a
    /// vsock to the host, which is how they ran before outbound access was
    /// needed for OAuth device flows like `claude setup-token`.
    pub guest_network: bool,
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
            max_sandboxes: environment_number("CODEV_MAX_SANDBOXES", 6)?,
            vcpu_count: environment_number("CODEV_VM_VCPU", 2)?,
            memory_mib: environment_number("CODEV_VM_MEMORY_MIB", 2048)?,
            workspace_disk_gib: environment_number("CODEV_VM_DISK_GIB", 10)?,
            guest_network: !matches!(
                std::env::var("CODEV_GUEST_NETWORK").as_deref(),
                Ok("0") | Ok("false")
            ),
            idle_timeout: environment_duration(
                "CODEV_IDLE_TIMEOUT",
                Duration::from_secs(4 * 60 * 60),
            )?,
        };
        if !(1..=6).contains(&config.max_sandboxes) {
            return Err(RuntimeError::BadRequest(
                "CODEV_MAX_SANDBOXES must be between 1 and 6".into(),
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
        if !(1..=10).contains(&config.workspace_disk_gib) {
            return Err(RuntimeError::BadRequest(
                "CODEV_VM_DISK_GIB must be between 1 and 10".into(),
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
    persistent_mount_dir: Option<PathBuf>,
    persistent_bind_path: Option<PathBuf>,
    jail_dir: PathBuf,
    slot: u32,
    reap_on_expiry: bool,
    hibernate_on_idle: bool,
    hibernating: AtomicBool,
    reaper_exempt_requests: AtomicUsize,
}

struct ReaperExemptRequest<'a>(&'a AtomicUsize);

impl<'a> ReaperExemptRequest<'a> {
    fn new(count: &'a AtomicUsize) -> Self {
        count.fetch_add(1, Ordering::AcqRel);
        Self(count)
    }
}

impl Drop for ReaperExemptRequest<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
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
    #[serde(default)]
    kind: SnapshotKind,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum SnapshotKind {
    #[default]
    FullMachine,
    WorkspaceDisks,
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
        // A full snapshot includes the guest memory file and can exceed the
        // normal control-plane request budget on a cold host. Keep the short
        // timeout for interactive API calls while allowing snapshot creation
        // enough time to finish; restore is still measured independently.
        let request_timeout = if path == "/snapshot/create" {
            Duration::from_secs(600)
        } else {
            Duration::from_secs(30)
        };
        let headers = timeout(
            request_timeout,
            read_until_sequence(&mut stream, b"\r\n\r\n", 64 << 10),
        )
        .await
        .map_err(|_| RuntimeError::Timeout("Firecracker API request timed out".into()))?
        .map_err(RuntimeError::internal)?;
        let header_text = String::from_utf8_lossy(&headers);
        let content_length = header_text
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())
                    .flatten()
            })
            .unwrap_or(0);
        let mut response_body = vec![0; content_length];
        timeout(request_timeout, stream.read_exact(&mut response_body))
            .await
            .map_err(|_| RuntimeError::Timeout("Firecracker API request timed out".into()))?
            .map_err(RuntimeError::internal)?;

        let status = header_text
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|value| value.parse::<u16>().ok())
            .ok_or_else(|| RuntimeError::Internal("invalid Firecracker API status".into()))?;
        if !(200..300).contains(&status) {
            let body = String::from_utf8_lossy(&response_body);
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

async fn load_snapshot_while_firecracker_runs(
    api: &FirecrackerApiClient,
    child: &Mutex<Child>,
) -> std::result::Result<(), SnapshotRestoreFailure> {
    tokio::select! {
        result = api.load_snapshot() => result.map_err(SnapshotRestoreFailure::Api),
        exit = async {
            let mut child = child.lock().await;
            child.wait().await
        } => {
            match exit {
                Ok(status) => Err(SnapshotRestoreFailure::FirecrackerExited(status)),
                Err(error) => Err(SnapshotRestoreFailure::Api(RuntimeError::internal(error))),
            }
        }
    }
}

enum SnapshotRestoreFailure {
    Api(RuntimeError),
    FirecrackerExited(std::process::ExitStatus),
}

async fn restore_snapshot_while_firecracker_runs(
    api: &FirecrackerApiClient,
    child: &Mutex<Child>,
    timeout_duration: Duration,
) -> Result<()> {
    timeout(timeout_duration, async {
        loop {
            match load_snapshot_while_firecracker_runs(api, child).await {
                Ok(()) => return Ok(()),
                Err(SnapshotRestoreFailure::Api(RuntimeError::Unavailable(_))) => {
                    sleep(Duration::from_millis(100)).await
                }
                Err(SnapshotRestoreFailure::Api(error)) => return Err(error),
                Err(SnapshotRestoreFailure::FirecrackerExited(status)) => {
                    return Err(RuntimeError::Unavailable(format!(
                        "Firecracker exited before snapshot restore: {status}"
                    )));
                }
            }
        }
    })
    .await
    .map_err(|_| RuntimeError::Timeout("Firecracker snapshot restore timed out".into()))?
}

async fn read_until_sequence(
    stream: &mut UnixStream,
    sequence: &[u8],
    limit: usize,
) -> Result<Vec<u8>> {
    let mut output = Vec::new();
    while output.len() < limit {
        let mut byte = [0_u8; 1];
        stream
            .read_exact(&mut byte)
            .await
            .map_err(RuntimeError::internal)?;
        output.push(byte[0]);
        if output.ends_with(sequence) {
            return Ok(output);
        }
    }
    Err(RuntimeError::Internal(
        "Firecracker response headers exceed 64 KiB".into(),
    ))
}

pub struct FirecrackerBackend {
    config: FirecrackerConfig,
    machines: AsyncRwLock<HashMap<String, Arc<RunningMachine>>>,
    provision: Mutex<()>,
    host_shutdown_pending: AtomicBool,
}

impl FirecrackerBackend {
    pub async fn new(config: FirecrackerConfig) -> Result<Self> {
        let backend = Self {
            config,
            machines: AsyncRwLock::new(HashMap::new()),
            provision: Mutex::new(()),
            host_shutdown_pending: AtomicBool::new(false),
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

    pub async fn begin_host_shutdown_if_idle(&self) -> bool {
        let _guard = self.provision.lock().await;
        if !self.machines.read().await.is_empty() {
            return false;
        }
        self.host_shutdown_pending.store(true, Ordering::Release);
        true
    }

    pub fn cancel_host_shutdown(&self) {
        self.host_shutdown_pending.store(false, Ordering::Release);
    }

    pub async fn reap_expired(&self) -> usize {
        let _guard = self.provision.lock().await;
        let now = Utc::now();
        let expired = {
            let machines = self.machines.read().await;
            machines
                .iter()
                .filter(|&(_, machine)| {
                    let instance = machine.instance.read().expect("machine lock");
                    let idle = (now - instance.last_activity_at)
                        .to_std()
                        .is_ok_and(|elapsed| elapsed >= self.config.idle_timeout);
                    (machine.hibernate_on_idle && idle)
                        || (machine.reap_on_expiry && instance.expires_at <= now)
                })
                .map(|(workspace_id, machine)| (workspace_id.clone(), machine.clone()))
                .collect::<Vec<_>>()
        };

        let mut reaped = 0;
        for (workspace_id, machine) in expired {
            if machine
                .hibernating
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_err()
            {
                continue;
            }
            let now = Utc::now();
            let still_expired = {
                let instance = machine.instance.read().expect("machine lock");
                let still_idle = (now - instance.last_activity_at)
                    .to_std()
                    .is_ok_and(|elapsed| elapsed >= self.config.idle_timeout);
                machine.hibernate_on_idle && still_idle
                    || machine.reap_on_expiry && instance.expires_at <= now
            };
            if !still_expired {
                machine.hibernating.store(false, Ordering::Release);
                continue;
            }

            let reaper_exempt = machine.reaper_exempt_requests.load(Ordering::Acquire);
            if has_reaper_blocking_requests(Arc::strong_count(&machine), reaper_exempt) {
                machine.hibernating.store(false, Ordering::Release);
                continue;
            }
            let idle = machine.hibernate_on_idle;
            let result = if idle {
                self.hibernate_machine(machine.clone()).await
            } else {
                self.stop_machine(machine.clone()).await
            };
            match result {
                Ok(()) => {
                    self.machines.write().await.remove(&workspace_id);
                    reaped += 1;
                    if idle {
                        info!(%workspace_id, "hibernated idle Firecracker sandbox");
                    } else {
                        info!(%workspace_id, "stopped expired Firecracker sandbox");
                    }
                }
                Err(error) => {
                    machine.hibernating.store(false, Ordering::Release);
                    warn!(%workspace_id, %error, "failed to stop expired Firecracker sandbox");
                }
            }
        }
        reaped
    }

    pub async fn create(&self, request: CreateRequest) -> Result<Instance> {
        let _guard = self.provision.lock().await;
        if self.host_shutdown_pending.load(Ordering::Acquire) {
            return Err(RuntimeError::Unavailable(
                "Firecracker host is shutting down".into(),
            ));
        }
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
        let machine = self.machine(workspace_id).await?;
        Ok(machine.instance.read().expect("machine lock").clone())
    }

    pub async fn touch(&self, workspace_id: &str) -> Result<Instance> {
        let machine = self.machine(workspace_id).await?;
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
        remove_directory_if_present(&self.snapshot_dir(workspace_id)).await?;
        remove_directory_if_present(&self.previous_snapshot_dir(workspace_id)).await
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

    pub async fn superset_health(&self, workspace_id: &str) -> Result<()> {
        let machine = self.machine(workspace_id).await?;
        machine.guest.superset_health().await
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
        // A terminal's empty long-poll is transport, not user activity. Let
        // the idle reaper hibernate even if that poll is currently parked.
        let machine = self.machine_without_activity(workspace_id).await?;
        let _reaper_exempt = ReaperExemptRequest::new(&machine.reaper_exempt_requests);
        machine.guest.poll_terminal(session_id, &request).await
    }

    pub async fn close_terminal(&self, workspace_id: &str, session_id: &str) -> Result<()> {
        let machine = self.machine(workspace_id).await?;
        machine.guest.close_terminal(session_id).await?;
        self.mark_activity(&machine);
        Ok(())
    }

    pub async fn start_codex_exec(
        &self,
        workspace_id: &str,
        request: CodexExecStartRequest,
    ) -> Result<String> {
        let machine = self.machine(workspace_id).await?;
        let result = machine.guest.start_codex_exec(&request).await?;
        self.mark_activity(&machine);
        Ok(result)
    }

    pub async fn poll_codex_exec(
        &self,
        workspace_id: &str,
        session_id: &str,
        request: CodexExecPollRequest,
    ) -> Result<CodexExecPollResponse> {
        let machine = self.machine(workspace_id).await?;
        let result = machine.guest.poll_codex_exec(session_id, &request).await?;
        self.mark_activity(&machine);
        Ok(result)
    }

    pub async fn close_codex_exec(&self, workspace_id: &str, session_id: &str) -> Result<()> {
        let machine = self.machine(workspace_id).await?;
        machine.guest.close_codex_exec(session_id).await?;
        self.mark_activity(&machine);
        Ok(())
    }

    pub async fn start_claude_setup(
        &self,
        workspace_id: &str,
        request: ClaudeSetupStartRequest,
    ) -> Result<serde_json::Value> {
        let machine = self.machine(workspace_id).await?;
        let result = machine.guest.start_claude_setup(&request).await?;
        self.mark_activity(&machine);
        Ok(result)
    }

    pub async fn input_claude_setup_code(
        &self,
        workspace_id: &str,
        session_id: &str,
        request: ClaudeSetupCodeRequest,
    ) -> Result<()> {
        let machine = self.machine(workspace_id).await?;
        machine
            .guest
            .input_claude_setup_code(session_id, &request)
            .await?;
        self.mark_activity(&machine);
        Ok(())
    }

    pub async fn poll_claude_setup(
        &self,
        workspace_id: &str,
        session_id: &str,
        request: ClaudeSetupPollRequest,
    ) -> Result<ClaudeSetupPollResponse> {
        let machine = self.machine(workspace_id).await?;
        let result = machine
            .guest
            .poll_claude_setup(session_id, &request)
            .await?;
        self.mark_activity(&machine);
        Ok(result)
    }

    pub async fn close_claude_setup(&self, workspace_id: &str, session_id: &str) -> Result<()> {
        let machine = self.machine(workspace_id).await?;
        machine.guest.close_claude_setup(session_id).await?;
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

    pub async fn begin_session_restore(
        &self,
        workspace_id: &str,
        request: SessionRestoreBeginRequest,
    ) -> Result<()> {
        let machine = self.machine(workspace_id).await?;
        machine.guest.begin_session_restore(&request).await?;
        self.mark_activity(&machine);
        Ok(())
    }

    pub async fn append_session_restore_chunk(
        &self,
        workspace_id: &str,
        operation_id: &str,
        request: SessionRestoreChunkRequest,
    ) -> Result<u64> {
        let machine = self.machine(workspace_id).await?;
        let offset = machine
            .guest
            .append_session_restore_chunk(operation_id, &request)
            .await?;
        self.mark_activity(&machine);
        Ok(offset)
    }

    pub async fn finalize_session_restore(
        &self,
        workspace_id: &str,
        operation_id: &str,
    ) -> Result<SessionRestoreFinalizeResponse> {
        let machine = self.machine(workspace_id).await?;
        let response = machine.guest.finalize_session_restore(operation_id).await?;
        self.mark_activity(&machine);
        Ok(response)
    }

    pub async fn abort_session_restore(
        &self,
        workspace_id: &str,
        operation_id: &str,
    ) -> Result<()> {
        let machine = self.machine(workspace_id).await?;
        machine.guest.abort_session_restore(operation_id).await?;
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
        self.machine_with_activity(workspace_id, true).await
    }

    async fn machine_without_activity(&self, workspace_id: &str) -> Result<Arc<RunningMachine>> {
        self.machine_with_activity(workspace_id, false).await
    }

    async fn machine_with_activity(
        &self,
        workspace_id: &str,
        count_as_activity: bool,
    ) -> Result<Arc<RunningMachine>> {
        let machine = self
            .machines
            .read()
            .await
            .get(workspace_id)
            .cloned()
            .ok_or(RuntimeError::SandboxNotFound)?;
        if machine.hibernating.load(Ordering::Acquire) {
            return Err(RuntimeError::Unavailable(
                "sandbox is shutting down after inactivity".into(),
            ));
        }
        if count_as_activity {
            self.mark_activity(&machine);
        }
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

    fn previous_snapshot_dir(&self, workspace_id: &str) -> PathBuf {
        self.config
            .jailer_dir
            .join("snapshots")
            .join(format!(".{workspace_id}.previous"))
    }

    async fn snapshot_metadata(
        &self,
        workspace_id: &str,
    ) -> Result<Option<(PathBuf, MicroVmSnapshotMetadata)>> {
        let mut directory = self.snapshot_dir(workspace_id);
        let metadata_path = directory.join("metadata.json");
        let contents = match fs::read(&metadata_path).await {
            Ok(contents) => contents,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                directory = self.previous_snapshot_dir(workspace_id);
                match fs::read(directory.join("metadata.json")).await {
                    Ok(contents) => contents,
                    Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
                    Err(error) => return Err(RuntimeError::internal(error)),
                }
            }
            Err(error) => return Err(RuntimeError::internal(error)),
        };
        let metadata: MicroVmSnapshotMetadata =
            serde_json::from_slice(&contents).map_err(|error| {
                RuntimeError::Internal(format!(
                    "invalid Firecracker snapshot metadata for {workspace_id}: {error}"
                ))
            })?;
        for name in ["snapshot_file", "mem_file", "rootfs.ext4", "workspace.ext4"] {
            if metadata.kind == SnapshotKind::WorkspaceDisks
                && matches!(name, "snapshot_file" | "mem_file")
            {
                continue;
            }
            if !directory.join(name).is_file() {
                return Err(RuntimeError::Unavailable(format!(
                    "Firecracker snapshot for {workspace_id} is incomplete"
                )));
            }
        }
        Ok(Some((directory, metadata)))
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
                kind: SnapshotKind::FullMachine,
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

    /// Keep the writable guest disks, but discard guest RAM and release its
    /// slot. A later create boots these disks into a fresh microVM, which can
    /// use any free tap/CID instead of pinning capacity to the old slot.
    async fn hibernate_machine(&self, machine: Arc<RunningMachine>) -> Result<()> {
        if machine.persistent_mount_dir.is_some() {
            // The attached Azure disk is already durable; just flush and stop.
            return self.stop_machine(machine).await;
        }

        machine.guest.flush_workspace().await?;
        let api = FirecrackerApiClient::new(machine.api_socket.clone());
        api.pause().await?;

        let workspace_id = machine.workspace_id();
        let snapshots_root = self.config.jailer_dir.join("snapshots");
        let staging = snapshots_root.join(format!(".{workspace_id}.idle.next"));
        let destination = self.snapshot_dir(&workspace_id);
        let previous = self.previous_snapshot_dir(&workspace_id);
        let persist_result = async {
            fs::create_dir_all(&snapshots_root)
                .await
                .map_err(RuntimeError::internal)?;
            remove_directory_if_present(&staging).await?;
            fs::create_dir_all(&staging)
                .await
                .map_err(RuntimeError::internal)?;
            for (name, source) in [
                ("rootfs.ext4", machine.jail_dir.join("root/rootfs.ext4")),
                (
                    "workspace.ext4",
                    machine.jail_dir.join("root/workspace.ext4"),
                ),
            ] {
                link_or_copy(&source, &staging.join(name)).await?;
            }
            let metadata = serde_json::to_vec(&MicroVmSnapshotMetadata {
                head_sha: machine
                    .instance
                    .read()
                    .expect("machine lock")
                    .head_sha
                    .clone(),
                slot: machine.slot,
                kind: SnapshotKind::WorkspaceDisks,
            })
            .map_err(RuntimeError::internal)?;
            fs::write(staging.join("metadata.json"), metadata)
                .await
                .map_err(RuntimeError::internal)?;

            remove_directory_if_present(&previous).await?;
            let had_previous = match fs::rename(&destination, &previous).await {
                Ok(()) => true,
                Err(error) if error.kind() == ErrorKind::NotFound => false,
                Err(error) => return Err(RuntimeError::internal(error)),
            };
            if let Err(error) = fs::rename(&staging, &destination).await {
                if had_previous {
                    let _ = fs::rename(&previous, &destination).await;
                }
                return Err(RuntimeError::internal(error));
            }
            if had_previous && let Err(error) = remove_directory_if_present(&previous).await {
                warn!(%workspace_id, %error, "could not remove prior Firecracker checkpoint");
            }
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

        self.stop_machine(machine).await
    }

    async fn prepare_and_start(&self, request: &CreateRequest) -> Result<RunningMachine> {
        let mut restore_from_saved_disks = false;
        loop {
            let mut full_snapshot_restore_failed = false;
            match self
                .prepare_and_start_attempt(
                    request,
                    restore_from_saved_disks,
                    &mut full_snapshot_restore_failed,
                )
                .await
            {
                Ok(machine) => return Ok(machine),
                Err(error) if full_snapshot_restore_failed && !restore_from_saved_disks => {
                    warn!(
                        workspace_id = %request.workspace_id,
                        %error,
                        "full Firecracker snapshot restore failed; retrying from saved workspace disks"
                    );
                    restore_from_saved_disks = true;
                }
                Err(error) => return Err(error),
            }
        }
    }

    async fn prepare_and_start_attempt(
        &self,
        request: &CreateRequest,
        restore_from_saved_disks: bool,
        full_snapshot_restore_failed: &mut bool,
    ) -> Result<RunningMachine> {
        let snapshot_state =
            if request.resume_from_snapshot && request.persistent_disk_lun.is_none() {
                self.snapshot_metadata(&request.workspace_id).await?
            } else {
                None
            };
        let snapshot_metadata = snapshot_state.as_ref().map(|(_, metadata)| metadata);
        let snapshot_directory = snapshot_state
            .as_ref()
            .map(|(directory, _)| directory.clone())
            .unwrap_or_else(|| self.snapshot_dir(&request.workspace_id));
        let restore_snapshot = !restore_from_saved_disks
            && snapshot_metadata.is_some_and(|metadata| metadata.kind == SnapshotKind::FullMachine);
        let disk_checkpoint = snapshot_metadata.filter(|metadata| {
            restore_from_saved_disks || metadata.kind == SnapshotKind::WorkspaceDisks
        });
        if restore_from_saved_disks && disk_checkpoint.is_none() {
            return Err(RuntimeError::Unavailable(
                "saved Firecracker workspace disks are unavailable for recovery".into(),
            ));
        }
        let slot = {
            let machines = self.machines.read().await;
            if restore_snapshot {
                let metadata = snapshot_metadata.expect("snapshot metadata");
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
        let persistent_storage = match request.persistent_disk_lun {
            Some(lun) => Some(
                self.prepare_persistent_storage(&request.workspace_id, lun)
                    .await?,
            ),
            None => None,
        };
        let uid = 20_000 + slot;
        let guest_cid = GUEST_CID_BASE + slot;
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
            self.prepare_snapshot_resources(&snapshot_directory, &jail_root, uid)
                .await
                .map(|_| {
                    snapshot_metadata
                        .expect("snapshot metadata")
                        .head_sha
                        .clone()
                })
        } else {
            self.prepare_resources(
                request,
                &workspace_dir,
                &jail_root,
                guest_cid,
                persistent_storage
                    .as_ref()
                    .map(|(_, workspace_image)| workspace_image.as_path()),
                disk_checkpoint.map(|metadata| (snapshot_directory.as_path(), metadata)),
            )
            .await
        } {
            Ok(head_sha) => head_sha,
            Err(error) => {
                let _ = remove_directory_if_present(&workspace_dir).await;
                let _ = remove_directory_if_present(&jail_dir).await;
                if let Some((mount_dir, _)) = persistent_storage.as_ref() {
                    let _ = unmount_path(mount_dir).await;
                }
                return Err(error);
            }
        };

        let persistent_bind_path = if let Some((_, workspace_image)) = persistent_storage.as_ref() {
            let bind_path = jail_root.join("workspace.ext4");
            OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(false)
                .open(&bind_path)
                .map_err(RuntimeError::internal)?;
            let mut bind = Command::new("mount");
            bind.arg("--bind").arg(workspace_image).arg(&bind_path);
            if let Err(error) = run_command(bind, "bind persistent workspace disk").await {
                let _ = remove_directory_if_present(&workspace_dir).await;
                let _ = remove_directory_if_present(&jail_dir).await;
                let _ = unmount_path(&persistent_storage.as_ref().unwrap().0).await;
                return Err(error);
            }
            Some(bind_path)
        } else {
            None
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

        if self.config.guest_network {
            ensure_tap(slot as usize).await?;
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
            persistent_mount_dir: persistent_storage.map(|(mount_dir, _)| mount_dir),
            persistent_bind_path,
            jail_dir,
            slot,
            reap_on_expiry: request.ephemeral,
            hibernate_on_idle: request.hibernate_on_idle,
            hibernating: AtomicBool::new(false),
            reaper_exempt_requests: AtomicUsize::new(0),
        };

        if restore_snapshot {
            let restore_started_at = Instant::now();
            let api = FirecrackerApiClient::new(machine.api_socket.clone());
            match restore_snapshot_while_firecracker_runs(
                &api,
                &machine.child,
                Duration::from_secs(45),
            )
            .await
            {
                Ok(()) => {
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
                Err(error) => {
                    self.cleanup_failed_machine(&machine).await;
                    *full_snapshot_restore_failed = true;
                    return Err(error);
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
                if snapshot_state.is_some() {
                    remove_directory_if_present(&self.snapshot_dir(&request.workspace_id)).await?;
                    remove_directory_if_present(&self.previous_snapshot_dir(&request.workspace_id))
                        .await?;
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
        persistent_workspace_image: Option<&Path>,
        disk_checkpoint: Option<(&Path, &MicroVmSnapshotMetadata)>,
    ) -> Result<String> {
        let workspace_disk = persistent_workspace_image
            .map(PathBuf::from)
            .unwrap_or_else(|| jail_root.join("workspace.ext4"));
        let existing_persistent_disk =
            persistent_workspace_image.is_some() && workspace_disk.is_file();
        let head_sha = if let Some((checkpoint_directory, metadata)) = disk_checkpoint {
            clone_or_copy(
                &checkpoint_directory.join("rootfs.ext4"),
                &jail_root.join("rootfs.ext4"),
            )
            .await?;
            clone_or_copy(
                &checkpoint_directory.join("workspace.ext4"),
                &workspace_disk,
            )
            .await?;
            metadata.head_sha.clone()
        } else if existing_persistent_disk {
            request.base_sha.clone()
        } else {
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
            head_sha
        };

        if disk_checkpoint.is_none() {
            let mut copy = Command::new("cp");
            copy.args(["--reflink=auto", "--sparse=always"])
                .arg(&self.config.rootfs_image)
                .arg(jail_root.join("rootfs.ext4"));
            run_command(copy, "copy guest rootfs").await?;
        }
        fs::copy(&self.config.kernel_image, jail_root.join("vmlinux"))
            .await
            .map_err(RuntimeError::internal)?;

        // Guests reach the internet through a per-slot tap the host NATs.
        // The address is handed over as a kernel `ip=` argument so eth0 is up
        // before init runs -- there is no DHCP client, and no userspace in the
        // guest that would configure it. `off` is the autoconf field: static
        // only. DNS comes from /etc/resolv.conf baked into the base rootfs by
        // bootstrap-host.sh, since `ip=` carries no resolver.
        let slot = (guest_cid - GUEST_CID_BASE) as usize;
        let base_boot_args = "keep_bootcon console=ttyS0 reboot=k panic=1 pci=off root=/dev/vda rw";
        let (boot_args, network_interfaces) = if self.config.guest_network {
            (
                format!(
                    "{base_boot_args} ip={}::{}:{}::eth0:off",
                    guest_ip(slot),
                    host_ip(slot),
                    GUEST_NETMASK
                ),
                json!([{
                    "iface_id": "eth0",
                    "host_dev_name": tap_name(slot),
                }]),
            )
        } else {
            (base_boot_args.to_string(), json!([]))
        };

        let config = json!({
            "boot-source": {
                "kernel_image_path": "/vmlinux",
                "boot_args": boot_args
            },
            "network-interfaces": network_interfaces,
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

    async fn prepare_persistent_storage(
        &self,
        workspace_id: &str,
        lun: u32,
    ) -> Result<(PathBuf, PathBuf)> {
        if lun == 0 || lun > MAX_DATA_DISK_LUN {
            return Err(RuntimeError::BadRequest(
                "persistent workspace disk LUN is outside the Azure data-disk range".into(),
            ));
        }
        let device = PathBuf::from(format!("/dev/disk/azure/scsi1/lun{lun}"));
        if !device.exists() {
            return Err(RuntimeError::Unavailable(format!(
                "persistent workspace disk is not attached at {}",
                device.display()
            )));
        }
        let mount_dir = self
            .config
            .runtime_dir
            .join("persistent-workspaces")
            .join(workspace_id);
        fs::create_dir_all(&mount_dir)
            .await
            .map_err(RuntimeError::internal)?;
        let mut mountpoint = Command::new("mountpoint");
        mountpoint.arg("-q").arg(&mount_dir);
        let mounted =
            command_succeeded(&mut mountpoint, "check persistent workspace mount").await?;
        if !mounted {
            let mut blkid = Command::new("blkid");
            blkid.args(["-o", "value", "-s", "TYPE"]).arg(&device);
            let has_filesystem =
                command_succeeded(&mut blkid, "inspect persistent workspace disk").await?;
            if !has_filesystem {
                let mut mkfs = Command::new("mkfs.ext4");
                mkfs.args(["-q", "-F", "-L", "CODEV_WORKSPACE_DATA"])
                    .arg(&device);
                run_command(mkfs, "format persistent workspace disk").await?;
            }
            let mut mount = Command::new("mount");
            mount.arg(&device).arg(&mount_dir);
            run_command(mount, "mount persistent workspace disk").await?;
        }
        Ok((mount_dir.clone(), mount_dir.join("workspace.ext4")))
    }

    async fn cleanup_failed_machine(&self, machine: &RunningMachine) {
        let _ = machine.child.lock().await.kill().await;
        let _ = machine.child.lock().await.wait().await;
        if self.config.guest_network {
            remove_tap(machine.slot as usize).await;
        }
        if let Some(path) = machine.persistent_bind_path.as_ref() {
            let _ = unmount_path(path).await;
        }
        let _ = remove_directory_if_present(&machine.jail_dir).await;
        if let Some(path) = machine.persistent_mount_dir.as_ref() {
            let _ = unmount_path(path).await;
        }
        let _ = remove_directory_if_present(&machine.workspace_dir).await;
    }

    async fn stop_machine(&self, machine: Arc<RunningMachine>) -> Result<()> {
        if machine.persistent_mount_dir.is_some() {
            machine.guest.flush_workspace().await?;
        }
        {
            let mut child = machine.child.lock().await;
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        if self.config.guest_network {
            remove_tap(machine.slot as usize).await;
        }
        if let Some(path) = machine.persistent_bind_path.as_ref() {
            unmount_path(path).await?;
        }
        remove_directory_if_present(&machine.jail_dir).await?;
        if let Some(path) = machine.persistent_mount_dir.as_ref() {
            unmount_path(path).await?;
        }
        remove_directory_if_present(&machine.workspace_dir).await
    }
}

const MAX_DATA_DISK_LUN: u32 = 63;

async fn command_succeeded(command: &mut Command, description: &str) -> Result<bool> {
    let output = timeout(Duration::from_secs(30), command.output())
        .await
        .map_err(|_| RuntimeError::Timeout(format!("{description} timed out")))?
        .map_err(RuntimeError::internal)?;
    Ok(output.status.success())
}

async fn unmount_path(path: &Path) -> Result<()> {
    let mut umount = Command::new("umount");
    umount.arg(path);
    run_command(umount, "unmount workspace storage").await
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
/// copying multi-GiB block devices. The host provisions `/srv/jailer` as XFS
/// with reflinks enabled; fail rather than silently taking a slow full-copy
/// path on an incorrectly configured host.
async fn clone_or_copy(source: &Path, destination: &Path) -> Result<()> {
    let output = Command::new("cp")
        .args(["--reflink=always", "--sparse=auto"])
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

/// The map and the reaper's candidate list own two references. Terminal
/// long-polls are explicitly exempt because they are transport, not activity;
/// every other in-flight request must hold the machine open until it finishes.
fn has_reaper_blocking_requests(machine_references: usize, reaper_exempt: usize) -> bool {
    machine_references > 2usize.saturating_add(reaper_exempt)
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
    use super::{
        FirecrackerApiClient, FirecrackerBackend, FirecrackerConfig, GUEST_CID_BASE,
        MicroVmSnapshotMetadata, SnapshotKind, first_available_slot, guest_ip,
        has_reaper_blocking_requests, host_ip, parse_duration,
        restore_snapshot_while_firecracker_runs, tap_name,
    };
    use crate::model::RuntimeError;
    use std::{
        collections::HashMap,
        path::PathBuf,
        sync::atomic::{AtomicBool, Ordering},
        time::{Duration, Instant},
    };
    use tokio::{
        process::Command,
        sync::{Mutex, RwLock as AsyncRwLock},
    };

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
        assert_eq!(first_available_slot(0..5, 6), Some(5));
        assert_eq!(first_available_slot(0..6, 6), None);
    }

    #[test]
    fn terminal_long_polls_do_not_block_idle_hibernation() {
        assert!(!has_reaper_blocking_requests(2, 0));
        assert!(!has_reaper_blocking_requests(3, 1));
        assert!(has_reaper_blocking_requests(3, 0));
        assert!(has_reaper_blocking_requests(4, 1));
    }

    #[test]
    fn guest_slots_get_non_overlapping_point_to_point_subnets() {
        // Each slot is its own /30, so a guest's only on-link neighbour is the
        // host tap. If two slots ever shared a subnet, guests could address one
        // another directly and bypass the host's filtering entirely.
        for slot in 0..6 {
            assert_eq!(host_ip(slot), format!("10.200.{slot}.1"));
            assert_eq!(guest_ip(slot), format!("10.200.{slot}.2"));
            assert_eq!(tap_name(slot), format!("codev-tap{slot}"));
        }
        let all: std::collections::HashSet<String> = (0..6).map(guest_ip).collect();
        assert_eq!(all.len(), 6, "guest addresses must be unique per slot");
    }

    #[test]
    fn slot_is_recoverable_from_the_guest_cid() {
        // The boot arguments derive the slot back out of guest_cid; a restored
        // machine keeps its recorded slot, which is what makes its tap name
        // stable across a snapshot restore.
        for slot in 0u32..6 {
            let guest_cid = GUEST_CID_BASE + slot;
            assert_eq!((guest_cid - GUEST_CID_BASE) as usize, slot as usize);
        }
    }

    #[test]
    fn existing_full_snapshots_keep_their_restore_format() {
        let metadata: MicroVmSnapshotMetadata = serde_json::from_str(
            r#"{"head_sha":"fc1ba2947ffdaf8c1961e5342387e1079afface6","slot":3}"#,
        )
        .expect("legacy full snapshot metadata");
        assert_eq!(metadata.kind, SnapshotKind::FullMachine);
        assert_eq!(metadata.slot, 3);
    }

    #[tokio::test]
    async fn exits_during_snapshot_restore_are_reported_immediately() {
        let child = Command::new("sh")
            .args(["-c", "exit 17"])
            .spawn()
            .expect("spawn an exiting Firecracker stand-in");
        let child = Mutex::new(child);
        let api = FirecrackerApiClient::new(
            tempfile::tempdir()
                .expect("temporary directory")
                .path()
                .join("missing-api.socket"),
        );
        let started_at = Instant::now();

        let error = restore_snapshot_while_firecracker_runs(&api, &child, Duration::from_secs(45))
            .await
            .expect_err("an exited Firecracker process cannot restore a snapshot");

        assert!(matches!(
            error,
            RuntimeError::Unavailable(message)
                if message.contains("Firecracker exited before snapshot restore")
                    && message.contains("17")
        ));
        assert!(started_at.elapsed() < Duration::from_secs(2));
    }

    #[tokio::test]
    async fn shutdown_reservation_blocks_create_on_the_firecracker_backend() {
        let backend = FirecrackerBackend {
            config: FirecrackerConfig {
                runtime_dir: PathBuf::new(),
                kernel_image: PathBuf::new(),
                rootfs_image: PathBuf::new(),
                firecracker_bin: PathBuf::new(),
                jailer_bin: PathBuf::new(),
                jailer_dir: PathBuf::new(),
                max_sandboxes: 1,
                vcpu_count: 1,
                memory_mib: 256,
                workspace_disk_gib: 1,
                idle_timeout: Duration::from_secs(60),
                guest_network: false,
            },
            machines: AsyncRwLock::new(HashMap::new()),
            provision: Mutex::new(()),
            host_shutdown_pending: AtomicBool::new(false),
        };

        assert!(backend.begin_host_shutdown_if_idle().await);
        let request = serde_json::from_value(serde_json::json!({
            "workspaceId": "lifecycle-test",
            "repositoryUrl": null,
            "repositorySnapshot": {
                "files": [],
                "totalBytes": 0
            },
            "baseSha": "0000000000000000000000000000000000000000",
            "expiresAt": "2026-09-26T08:00:00Z",
            "resumeFromSnapshot": false,
            "lifecycle": {
                "timeoutMs": 14400000,
                "lifecycle": { "onTimeout": "pause", "autoResume": true }
            }
        }))
        .expect("valid create request");
        let error = backend
            .create(request)
            .await
            .expect_err("create must not race host deallocation");

        assert!(matches!(
            error,
            RuntimeError::Unavailable(message) if message.contains("host is shutting down")
        ));
        backend.cancel_host_shutdown();
        assert!(!backend.host_shutdown_pending.load(Ordering::Acquire));
    }
}
