use std::{
    collections::HashMap,
    fs::OpenOptions,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, RwLock},
    time::Duration,
};

use chrono::{DateTime, Utc};
use serde_json::json;
use tokio::{
    fs,
    process::{Child, Command},
    sync::{Mutex, RwLock as AsyncRwLock},
    time::{sleep, timeout},
};

use crate::{
    guest_client::GuestClient,
    model::{
        CreateRequest, ExecRequest, ExecResponse, FileResponse, Instance, Result, RuntimeError,
        TerminalInputRequest, TerminalPollRequest, TerminalPollResponse, TerminalResizeRequest,
        TerminalStartRequest, WorktreeCheckpointRequest, WorktreeCheckpointResponse,
        WorktreeCreateRequest, WorktreeMergeRequest, WorktreeMergeResponse, WorktreeRebaseRequest,
        WorktreeRebaseResponse, WorktreeReviewResponse, WriteFileRequest,
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
            idle_timeout: environment_duration("CODEV_IDLE_TIMEOUT", Duration::from_secs(30 * 60))?,
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
    workspace_dir: PathBuf,
    jail_dir: PathBuf,
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
        instance.last_activity_at = Utc::now();
        Ok(instance.clone())
    }

    pub async fn destroy(&self, workspace_id: &str) -> Result<()> {
        let machine = self
            .machines
            .write()
            .await
            .remove(workspace_id)
            .ok_or(RuntimeError::SandboxNotFound)?;
        self.stop_machine(machine).await
    }

    pub async fn reap_idle(&self, cutoff: DateTime<Utc>) -> Result<Vec<String>> {
        let now = Utc::now();
        let ids: Vec<_> = self
            .machines
            .read()
            .await
            .iter()
            .filter_map(|(id, machine)| {
                let instance = machine.instance.read().expect("machine lock");
                (instance.last_activity_at < cutoff || instance.expires_at <= now)
                    .then(|| id.clone())
            })
            .collect();
        let mut destroyed = Vec::new();
        for id in ids {
            if self.destroy(&id).await.is_ok() {
                destroyed.push(id);
            }
        }
        Ok(destroyed)
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
        self.machines
            .read()
            .await
            .get(workspace_id)
            .cloned()
            .ok_or(RuntimeError::SandboxNotFound)
    }

    fn mark_activity(&self, machine: &RunningMachine) {
        machine
            .instance
            .write()
            .expect("machine lock")
            .last_activity_at = Utc::now();
    }

    async fn prepare_and_start(&self, request: &CreateRequest) -> Result<RunningMachine> {
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

        let result = self
            .prepare_resources(request, &workspace_dir, &jail_root)
            .await;
        if let Err(error) = result {
            let _ = remove_directory_if_present(&workspace_dir).await;
            let _ = remove_directory_if_present(&jail_dir).await;
            return Err(error);
        }

        let uid = 20_000 + self.machines.read().await.len() as u32;
        let paths = [
            jail_root.join("vmlinux"),
            jail_root.join("rootfs.ext4"),
            jail_root.join("workspace.ext4"),
            jail_root.join("config.json"),
        ];
        let mut chown = Command::new("chown");
        chown.arg(format!("{uid}:{uid}")).args(&paths);
        run_command(chown, "chown jail resources").await?;
        for path in &paths {
            fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
                .await
                .map_err(RuntimeError::internal)?;
        }
        fs::set_permissions(&paths[0], std::fs::Permissions::from_mode(0o644))
            .await
            .map_err(RuntimeError::internal)?;

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
            .arg("/api.socket")
            .arg("--config-file")
            .arg("/config.json")
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .kill_on_drop(true);
        let child = command.spawn().map_err(RuntimeError::internal)?;
        let guest = GuestClient::new(jail_root.join("guest.vsock"), GUEST_PORT);
        let machine = RunningMachine {
            instance: RwLock::new(Instance {
                id: format!("fc-{id}"),
                workspace_id: request.workspace_id.clone(),
                status: "ready".into(),
                created_at: Utc::now(),
                last_activity_at: Utc::now(),
                expires_at: request.expires_at,
            }),
            child: Mutex::new(child),
            guest,
            workspace_dir,
            jail_dir,
        };

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
            Ok(Ok(())) => Ok(machine),
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
    ) -> Result<()> {
        let repository = workspace_dir.join("repository");
        let mut init = Command::new("git");
        init.arg("init").arg("--quiet").arg(&repository);
        run_command(init, "initialize repository").await?;
        let mut remote = Command::new("git");
        remote
            .arg("-C")
            .arg(&repository)
            .args(["remote", "add", "origin"])
            .arg(&request.repository_url);
        run_command(remote, "configure repository remote").await?;
        let mut fetch = Command::new("git");
        fetch
            .arg("-C")
            .arg(&repository)
            .args(["fetch", "--quiet", "--depth=1", "origin"])
            .arg(&request.base_sha);
        run_command(fetch, "fetch repository revision").await?;
        let mut checkout = Command::new("git");
        checkout
            .arg("-C")
            .arg(&repository)
            .args(["checkout", "--quiet", "--detach", "FETCH_HEAD"]);
        run_command(checkout, "checkout repository revision").await?;

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
                "guest_cid": 3,
                "uds_path": "/guest.vsock"
            }
        });
        fs::write(
            jail_root.join("config.json"),
            serde_json::to_vec(&config).map_err(RuntimeError::internal)?,
        )
        .await
        .map_err(RuntimeError::internal)
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

async fn remove_directory_if_present(path: &Path) -> Result<()> {
    match fs::remove_dir_all(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(RuntimeError::internal(error)),
    }
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
    } else if let Some(value) = value.strip_suffix('h') {
        (value, 3_600_000)
    } else {
        return None;
    };
    number
        .parse::<u64>()
        .ok()
        .and_then(|number| number.checked_mul(multiplier))
        .map(Duration::from_millis)
}

#[cfg(test)]
mod tests {
    use super::parse_duration;

    #[test]
    fn parses_runtime_durations() {
        assert_eq!(parse_duration("15m").expect("duration").as_secs(), 900);
        assert_eq!(parse_duration("4h").expect("duration").as_secs(), 14_400);
        assert!(parse_duration("soon").is_none());
    }
}
