//! Per-workspace Orca IDE runtime backend.
//!
//! Orca's own packaged (non-dev) build has no supported way to run two
//! isolated profiles as the same OS user on one host: `configureDevUserDataPath`
//! only honours overrides in dev/E2E builds, so `app.getPath('userData')` — and
//! therefore Electron's single-instance lock — always resolves to the same
//! fixed path for a packaged run (confirmed by inspecting
//! `stablyai/orca@v1.4.176`'s `src/main/startup/configure-process.ts`). A
//! second `orca serve` for the same OS user is refused outright.
//!
//! Real isolation therefore has to be OS-user isolation: each workspace gets
//! its own dedicated Linux user (home directory, `userData`, and
//! single-instance lock all follow from that), its own loopback port, and its
//! own `orca serve --project-root` scoped to that workspace's existing clone
//! directory. `orca serve --pairing-address https://<host>/w/<id>` embeds the
//! given address verbatim into the advertised endpoint, the pairing offer,
//! and the pairing code payload the web client decodes — confirmed against
//! the live host — so Caddy can path-route a single public port without any
//! pairing-payload rewriting on our side.
use std::{
    collections::HashMap,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, OnceLock},
    time::{Duration, Instant},
};

use chrono::Utc;
use regex::Regex;
use serde_json::Value;
use tokio::{
    fs,
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::TcpStream,
    process::{Child, Command},
    sync::{Mutex as AsyncMutex, RwLock as AsyncRwLock},
    time::timeout,
};
use tracing::{info, warn};

use crate::model::{IdeCloneRequest, IdeSession, IdeStartRequest, Result, RuntimeError};

const READY_TIMEOUT: Duration = Duration::from_secs(45);
const USER_PREFIX: &str = "orca-ws-";
const GIT_ASKPASS_BIN: &str = "/usr/local/libexec/codev-git-askpass";
/// Half of a 32-hex-char (UUID-without-dashes) workspace id. 84 bits of
/// entropy from a UUIDv4's random bits is far beyond any realistic collision
/// risk for this host's session count, and keeps the derived name under the
/// traditional 32-character Linux username limit with `orca-ws-` prepended.
const USER_SUFFIX_LEN: usize = 20;

pub struct OrcaConfig {
    pub app_run_bin: PathBuf,
    pub workspaces_root: PathBuf,
    pub public_host: String,
    pub caddy_admin_addr: String,
    pub display: String,
    pub port_range_start: u16,
    pub port_range_end: u16,
    pub max_sessions: usize,
    pub idle_timeout: Duration,
}

impl OrcaConfig {
    pub fn from_environment() -> Result<Self> {
        let config = Self {
            app_run_bin: environment_path(
                "CODEV_ORCA_APPRUN_BIN",
                "/opt/orca/squashfs-root/AppRun",
            ),
            workspaces_root: environment_path(
                "CODEV_ORCA_WORKSPACES_ROOT",
                "/srv/codev/workspaces",
            ),
            public_host: std::env::var("CODEV_ORCA_PUBLIC_HOST").unwrap_or_default(),
            caddy_admin_addr: std::env::var("CODEV_ORCA_CADDY_ADMIN_ADDR")
                .unwrap_or_else(|_| "127.0.0.1:2019".into()),
            display: std::env::var("CODEV_ORCA_DISPLAY").unwrap_or_else(|_| ":99".into()),
            port_range_start: environment_number("CODEV_ORCA_PORT_RANGE_START", 7_000)?,
            port_range_end: environment_number("CODEV_ORCA_PORT_RANGE_END", 7_999)?,
            max_sessions: environment_number("CODEV_MAX_IDE_SESSIONS", 4)?,
            idle_timeout: environment_duration(
                "CODEV_IDE_IDLE_TIMEOUT",
                Duration::from_secs(1_800),
            )?,
        };
        if config.public_host.trim().is_empty() {
            return Err(RuntimeError::BadRequest(
                "CODEV_ORCA_PUBLIC_HOST is required".into(),
            ));
        }
        if config.port_range_start >= config.port_range_end {
            return Err(RuntimeError::BadRequest(
                "CODEV_ORCA_PORT_RANGE_START must be less than CODEV_ORCA_PORT_RANGE_END".into(),
            ));
        }
        if !(1..=16).contains(&config.max_sessions) {
            return Err(RuntimeError::BadRequest(
                "CODEV_MAX_IDE_SESSIONS must be between 1 and 16".into(),
            ));
        }
        Ok(config)
    }
}

struct RunningSession {
    port: u16,
    linux_user: String,
    child: AsyncMutex<Child>,
    ready: Value,
    created_at: chrono::DateTime<Utc>,
    last_activity_at: std::sync::RwLock<chrono::DateTime<Utc>>,
}

impl RunningSession {
    fn touch(&self) {
        *self.last_activity_at.write().expect("session lock") = Utc::now();
    }

    fn idle_for(&self) -> Duration {
        let last = *self.last_activity_at.read().expect("session lock");
        (Utc::now() - last).to_std().unwrap_or(Duration::ZERO)
    }

    async fn is_running(&self) -> bool {
        matches!(self.child.lock().await.try_wait(), Ok(None))
    }

    fn to_model(&self, workspace_id: &str) -> IdeSession {
        IdeSession {
            workspace_id: workspace_id.to_string(),
            port: self.port,
            created_at: self.created_at,
            last_activity_at: *self.last_activity_at.read().expect("session lock"),
            ready: self.ready.clone(),
        }
    }
}

pub struct OrcaBackend {
    config: OrcaConfig,
    sessions: AsyncRwLock<HashMap<String, Arc<RunningSession>>>,
    provision: AsyncMutex<()>,
}

impl OrcaBackend {
    pub fn new(config: OrcaConfig) -> Arc<Self> {
        let backend = Arc::new(Self {
            config,
            sessions: AsyncRwLock::new(HashMap::new()),
            provision: AsyncMutex::new(()),
        });
        tokio::spawn(reap_idle_sessions(backend.clone()));
        backend
    }

    pub async fn start(&self, workspace_id: &str, request: IdeStartRequest) -> Result<IdeSession> {
        let expected_root = self.config.workspaces_root.join(workspace_id);
        if Path::new(&request.project_root) != expected_root {
            return Err(RuntimeError::BadRequest(
                "project root must be this workspace's clone directory".into(),
            ));
        }

        // Serialize start attempts for this backend: cheap (there are at most
        // `max_sessions` of these at once) and avoids double-spawning a
        // session or racing two Caddy config reloads for the same workspace.
        let _guard = self.provision.lock().await;

        if let Some(session) = self.sessions.read().await.get(workspace_id).cloned()
            && session.is_running().await
        {
            session.touch();
            return Ok(session.to_model(workspace_id));
        }
        // Either absent or the process died since the last check; drop any
        // stale entry before re-provisioning.
        self.sessions.write().await.remove(workspace_id);

        if self.sessions.read().await.len() >= self.config.max_sessions {
            return Err(RuntimeError::CapacityExceeded);
        }

        // A workspace with no linked repository still needs an existing
        // directory for `orca serve --serve-project-root` to open; cloning
        // (below) creates it for repository-backed workspaces, but this
        // covers the no-repository case too and is a no-op otherwise.
        tokio::fs::create_dir_all(&expected_root)
            .await
            .map_err(RuntimeError::internal)?;
        if let Some(clone) = &request.clone {
            ensure_workspace_clone(&expected_root, clone).await?;
        }

        let linux_user = linux_user_for(workspace_id);
        ensure_linux_user(&linux_user).await?;
        // The AppImage launches Electron children that can outlive the sudo
        // wrapper tracked in `RunningSession`. A previous orchestrator crash or
        // stop must not leave Electron's per-user single-instance lock held,
        // otherwise the replacement serve process exits before readiness.
        terminate_linux_user_processes(&linux_user).await?;
        chown_recursive(&expected_root, &linux_user).await?;
        if let Some(codex_auth_cache_json) = &request.codex_auth_cache_json {
            write_codex_credential(&linux_user, codex_auth_cache_json).await?;
        }
        let claude_env = if let Some(api_key) = &request.anthropic_api_key {
            Some(("ANTHROPIC_API_KEY", api_key.as_str()))
        } else {
            request
                .claude_code_oauth_token
                .as_deref()
                .map(|token| ("CLAUDE_CODE_OAUTH_TOKEN", token))
        };
        let port = self.allocate_port().await?;
        let pairing_address = format!("https://{}/w/{workspace_id}", self.config.public_host);

        let mut child = spawn_orca_serve(
            &self.config.app_run_bin,
            &linux_user,
            &self.config.display,
            port,
            &pairing_address,
            &expected_root,
            claude_env,
        )?;
        let ready = match wait_for_ready_line(&mut child).await {
            Ok(ready) => ready,
            Err(error) => {
                let _ = child.kill().await;
                return Err(error);
            }
        };
        drain_child_output_in_background(&mut child);

        let session = Arc::new(RunningSession {
            port,
            linux_user,
            child: AsyncMutex::new(child),
            ready,
            created_at: Utc::now(),
            last_activity_at: std::sync::RwLock::new(Utc::now()),
        });
        self.sessions
            .write()
            .await
            .insert(workspace_id.to_string(), session.clone());
        self.reload_caddy_routes().await?;
        info!(workspace_id, port, "started per-workspace Orca IDE session");
        Ok(session.to_model(workspace_id))
    }

    pub async fn status(&self, workspace_id: &str) -> Result<IdeSession> {
        let session = self
            .sessions
            .read()
            .await
            .get(workspace_id)
            .cloned()
            .ok_or(RuntimeError::SandboxNotFound)?;
        if !session.is_running().await {
            self.sessions.write().await.remove(workspace_id);
            self.reload_caddy_routes().await?;
            return Err(RuntimeError::SandboxNotFound);
        }
        Ok(session.to_model(workspace_id))
    }

    /// When any IDE session on this host was last used, if there are any.
    ///
    /// The host-level idle shutdown needs this rather than a session count.
    /// An Orca-only workspace never provisions a Firecracker sandbox, so
    /// counting sandboxes alone would power the host off mid-session — but
    /// counting *sessions* would be just as wrong in the other direction,
    /// because an abandoned session keeps existing until the reaper below
    /// removes it, and the host would then start a second full idle window
    /// from scratch. Reporting the timestamp lets both clocks run against the
    /// same moment: the last time somebody actually did something.
    pub async fn last_activity_at(&self) -> Option<chrono::DateTime<Utc>> {
        self.sessions
            .read()
            .await
            .values()
            .map(|session| *session.last_activity_at.read().expect("session lock"))
            .max()
    }

    /// Record browser-side activity against this workspace's IDE session. The
    /// browser connects straight to `orca serve` through Caddy and never
    /// touches the orchestrator, so without an explicit keepalive a session
    /// somebody is actively typing in looks idle and gets reaped.
    pub async fn touch(&self, workspace_id: &str) -> Result<IdeSession> {
        let session = self
            .sessions
            .read()
            .await
            .get(workspace_id)
            .cloned()
            .ok_or(RuntimeError::SandboxNotFound)?;
        session.touch();
        Ok(session.to_model(workspace_id))
    }

    pub async fn stop(&self, workspace_id: &str) -> Result<()> {
        let _guard = self.provision.lock().await;
        let session = self
            .sessions
            .write()
            .await
            .remove(workspace_id)
            .ok_or(RuntimeError::SandboxNotFound)?;
        self.destroy_session(workspace_id, &session).await;
        self.reload_caddy_routes().await
    }

    async fn destroy_session(&self, workspace_id: &str, session: &RunningSession) {
        let _ = session.child.lock().await.kill().await;
        if let Err(error) = terminate_linux_user_processes(&session.linux_user).await {
            warn!(
                workspace_id,
                user = %session.linux_user,
                %error,
                "failed to terminate per-workspace Orca process tree"
            );
        }
        // The dedicated user only ever owns this workspace's IDE state, so
        // removing it reclaims the account and its home directory instead of
        // accumulating one Linux user per workspace forever. Re-opening the
        // IDE later just redoes the (few-second) first-run setup.
        let output = Command::new("userdel")
            .args(["-r", &session.linux_user])
            .output()
            .await;
        if let Ok(output) = output
            && !output.status.success()
        {
            warn!(
                workspace_id,
                user = %session.linux_user,
                stderr = %String::from_utf8_lossy(&output.stderr),
                "failed to remove per-workspace Orca IDE user"
            );
        }
    }

    async fn allocate_port(&self) -> Result<u16> {
        let sessions = self.sessions.read().await;
        let taken: std::collections::HashSet<u16> =
            sessions.values().map(|session| session.port).collect();
        drop(sessions);
        for port in self.config.port_range_start..=self.config.port_range_end {
            if taken.contains(&port) {
                continue;
            }
            if TcpStream::connect(("127.0.0.1", port)).await.is_err() {
                return Ok(port);
            }
        }
        Err(RuntimeError::CapacityExceeded)
    }

    async fn reload_caddy_routes(&self) -> Result<()> {
        let sessions = self.sessions.read().await;
        let mut routes = String::new();
        for (workspace_id, session) in sessions.iter() {
            routes.push_str(&format!(
                "  handle_path /w/{workspace_id}* {{\n    reverse_proxy 127.0.0.1:{}\n  }}\n",
                session.port
            ));
        }
        drop(sessions);
        let caddyfile = format!(
            "{{\n  admin {}\n}}\n\n{} {{\n{routes}  respond 404\n}}\n",
            self.config.caddy_admin_addr, self.config.public_host
        );
        caddy_load(&self.config.caddy_admin_addr, &caddyfile).await
    }
}

async fn reap_idle_sessions(backend: Arc<OrcaBackend>) {
    let mut interval = tokio::time::interval(Duration::from_secs(30));
    loop {
        interval.tick().await;
        let idle: Vec<String> = backend
            .sessions
            .read()
            .await
            .iter()
            .filter(|(_, session)| session.idle_for() >= backend.config.idle_timeout)
            .map(|(workspace_id, _)| workspace_id.clone())
            .collect();
        for workspace_id in idle {
            info!(workspace_id, "stopping idle Orca IDE session");
            if let Err(error) = backend.stop(&workspace_id).await {
                warn!(workspace_id, %error, "failed to stop idle Orca IDE session");
            }
        }
    }
}

fn linux_user_for(workspace_id: &str) -> String {
    let hex_only: String = workspace_id.chars().filter(|c| *c != '-').collect();
    format!(
        "{USER_PREFIX}{}",
        &hex_only[..USER_SUFFIX_LEN.min(hex_only.len())]
    )
}

fn repository_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$").expect("repo regex"))
}

fn branch_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"^[A-Za-z0-9._/-]+$").expect("branch regex"))
}

fn token_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"^[A-Za-z0-9_.-]+$").expect("token regex"))
}

/// Idempotently clones a workspace's repository into its clone directory,
/// mirroring the shell script `buildCloneScript` in
/// `apps/web/lib/orca-pairing.ts` previously ran over SSM. Using `Command`'s
/// argv form (no shell) instead of an interpolated script removes the need
/// for the quoting/escaping care that script required.
async fn ensure_workspace_clone(expected_root: &Path, clone: &IdeCloneRequest) -> Result<()> {
    if expected_root.join(".git").is_dir() {
        return Ok(());
    }
    if !repository_pattern().is_match(&clone.repository) {
        return Err(RuntimeError::BadRequest("invalid repository name".into()));
    }
    if !branch_pattern().is_match(&clone.default_branch) || clone.default_branch.contains("..") {
        return Err(RuntimeError::BadRequest("invalid branch name".into()));
    }
    if let Some(token) = &clone.token
        && !token_pattern().is_match(token)
    {
        return Err(RuntimeError::BadRequest("invalid repository token".into()));
    }

    let plain_url = format!("https://github.com/{}.git", clone.repository);
    if let Some(parent) = expected_root.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(RuntimeError::internal)?;
    }
    let _ = tokio::fs::remove_dir_all(expected_root).await;

    let mut command = Command::new("git");
    command
        .args(["clone", "--branch", &clone.default_branch, &plain_url])
        .arg(expected_root)
        .env("GIT_TERMINAL_PROMPT", "0");
    if let Some(token) = &clone.token {
        command
            .env("GIT_ASKPASS", GIT_ASKPASS_BIN)
            .env("CODEV_GITHUB_TOKEN", token);
    }
    let output = command.output().await.map_err(RuntimeError::internal)?;
    if !output.status.success() {
        return Err(RuntimeError::internal(format!(
            "git clone failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }

    // Keep a credential-free remote. Authentication was supplied only to the
    // clone child process through GIT_ASKPASS, never through argv or the URL.
    let output = Command::new("git")
        .args(["-C"])
        .arg(expected_root)
        .args(["remote", "set-url", "origin", &plain_url])
        .output()
        .await
        .map_err(RuntimeError::internal)?;
    if !output.status.success() {
        return Err(RuntimeError::internal(format!(
            "git remote set-url failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }
    Ok(())
}

async fn ensure_linux_user(user: &str) -> Result<()> {
    let exists = Command::new("id")
        .args(["-u", user])
        .output()
        .await
        .map_err(RuntimeError::internal)?
        .status
        .success();
    if exists {
        return Ok(());
    }
    let output = Command::new("useradd")
        .args(["-m", "-s", "/bin/bash", user])
        .output()
        .await
        .map_err(RuntimeError::internal)?;
    if !output.status.success() {
        return Err(RuntimeError::internal(format!(
            "useradd {user} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }
    Ok(())
}

fn linux_user_process_command(program: &str, user: &str) -> Command {
    let mut command = Command::new(program);
    command.args(["-u", user]);
    command
}

/// Stops every process owned by a workspace's dedicated OS user. Electron
/// daemon, renderer, terminal, and agent children are not guaranteed to stay
/// beneath the short-lived `sudo` wrapper in the process tree, so killing only
/// the tracked child can leave the profile lock occupied indefinitely.
async fn terminate_linux_user_processes(user: &str) -> Result<()> {
    let mut kill = linux_user_process_command("pkill", user);
    kill.arg("-KILL");
    let output = kill.output().await.map_err(RuntimeError::internal)?;
    if !output.status.success() && output.status.code() != Some(1) {
        return Err(RuntimeError::internal(format!(
            "pkill workspace user {user} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let output = linux_user_process_command("pgrep", user)
            .output()
            .await
            .map_err(RuntimeError::internal)?;
        if output.status.code() == Some(1) {
            return Ok(());
        }
        if !output.status.success() {
            return Err(RuntimeError::internal(format!(
                "pgrep workspace user {user} failed: {}",
                String::from_utf8_lossy(&output.stderr)
            )));
        }
        if Instant::now() >= deadline {
            return Err(RuntimeError::Timeout(format!(
                "workspace user {user} still owns processes after termination"
            )));
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn chown_recursive(path: &Path, user: &str) -> Result<()> {
    let output = Command::new("chown")
        .args(["-R", &format!("{user}:{user}")])
        .arg(path)
        .output()
        .await
        .map_err(RuntimeError::internal)?;
    if !output.status.success() {
        return Err(RuntimeError::internal(format!(
            "chown {} failed: {}",
            path.display(),
            String::from_utf8_lossy(&output.stderr)
        )));
    }
    Ok(())
}

/// Writes a linked hosted-Codex-subscription credential to the Codex CLI's
/// standard config location for a per-workspace Linux user, so the CLI Orca
/// launches interactively is already signed in. Re-written on every start
/// (not just first-run) since the underlying OAuth material can rotate.
async fn write_codex_credential(user: &str, codex_auth_cache_json: &str) -> Result<()> {
    let codex_home = PathBuf::from(format!("/home/{user}/.codex"));
    fs::create_dir_all(&codex_home)
        .await
        .map_err(RuntimeError::internal)?;
    let auth_path = codex_home.join("auth.json");
    fs::write(&auth_path, codex_auth_cache_json)
        .await
        .map_err(RuntimeError::internal)?;
    fs::set_permissions(&codex_home, std::fs::Permissions::from_mode(0o700))
        .await
        .map_err(RuntimeError::internal)?;
    fs::set_permissions(&auth_path, std::fs::Permissions::from_mode(0o600))
        .await
        .map_err(RuntimeError::internal)?;
    chown_recursive(&codex_home, user).await
}

fn spawn_orca_serve(
    app_run_bin: &Path,
    user: &str,
    display: &str,
    port: u16,
    pairing_address: &str,
    project_root: &Path,
    claude_env: Option<(&str, &str)>,
) -> Result<Child> {
    orca_serve_sudo_command(
        app_run_bin,
        user,
        display,
        port,
        pairing_address,
        project_root,
        claude_env,
    )
    .spawn()
    .map_err(RuntimeError::internal)
}

fn orca_serve_sudo_command(
    app_run_bin: &Path,
    user: &str,
    display: &str,
    port: u16,
    pairing_address: &str,
    project_root: &Path,
    claude_env: Option<(&str, &str)>,
) -> Command {
    // A shell wrapper (matching production's own `run-serve.sh`) is the only
    // way to merge stderr into the single piped stream we scan for the ready
    // line, exactly like the existing shared instance already does. Every
    // interpolated value here is either produced by us (paths, port) or
    // already regex-validated by the HTTP layer (workspace id), and is
    // additionally single-quoted, so this does not accept caller-controlled
    // shell metacharacters.
    let command_line = orca_serve_command_line(
        app_run_bin,
        user,
        display,
        port,
        pairing_address,
        project_root,
    );
    let mut command = Command::new("sudo");
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    command.kill_on_drop(true);
    // `sudo` logs its own full invocation (argv) to the system journal, so a
    // linked provider credential must never appear as literal text in the
    // command it runs — confirmed a Claude OAuth token doing exactly that
    // when this was embedded as `env NAME='value'` in the shell string
    // below. Set it directly on this Command instead: sudo inherits it from
    // its own environment and `--preserve-env=NAME` (which logs only the
    // variable's *name*, never its value) forwards it to the target user,
    // so the secret only ever travels through envp, never argv.
    if let Some((name, value)) = claude_env {
        command.env(name, value);
        command.args([
            "-u",
            user,
            "-H",
            &format!("--preserve-env={name}"),
            "sh",
            "-c",
            &command_line,
        ]);
    } else {
        command.args(["-u", user, "-H", "sh", "-c", &command_line]);
    }
    command
}

fn orca_serve_command_line(
    app_run_bin: &Path,
    user: &str,
    display: &str,
    port: u16,
    pairing_address: &str,
    project_root: &Path,
) -> String {
    let npm_prefix = format!("/home/{user}/.npm-global");
    let path = format!("{npm_prefix}/bin:/usr/local/bin:/usr/bin:/bin");
    format!(
        "exec env DISPLAY={} LIBGL_ALWAYS_SOFTWARE=1 NPM_CONFIG_PREFIX={} PATH={} {} --serve --serve-port {port} --serve-pairing-address {} --serve-project-root {} --serve-json",
        shell_quote(display),
        shell_quote(&npm_prefix),
        shell_quote(&path),
        shell_quote(&app_run_bin.to_string_lossy()),
        shell_quote(pairing_address),
        shell_quote(&project_root.to_string_lossy()),
    )
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

async fn wait_for_ready_line(child: &mut Child) -> Result<Value> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| RuntimeError::Internal("Orca IDE process has no stdout".into()))?;
    let mut lines = BufReader::new(stdout).lines();
    let deadline = Instant::now() + READY_TIMEOUT;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(RuntimeError::Timeout(
                "Orca IDE process did not report readiness in time".into(),
            ));
        }
        let next = timeout(remaining, lines.next_line())
            .await
            .map_err(|_| {
                RuntimeError::Timeout("Orca IDE process did not report readiness in time".into())
            })?
            .map_err(RuntimeError::internal)?;
        let Some(line) = next else {
            return Err(RuntimeError::Internal(
                "Orca IDE process exited before reporting readiness".into(),
            ));
        };
        let trimmed = line.trim();
        if !trimmed.starts_with('{') {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) == Some("orca_server_ready") {
            let pairing_available = value
                .get("pairing")
                .and_then(|pairing| pairing.get("available"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if !pairing_available {
                return Err(RuntimeError::Unavailable(
                    "Orca IDE process started without an available pairing offer".into(),
                ));
            }
            return Ok(value);
        }
    }
}

/// The child keeps its own stdout/stderr pipes writable only while something
/// reads them; leaving them unread after the ready line would eventually
/// block the process the first time its own log buffer filled up.
fn drain_child_output_in_background(child: &mut Child) {
    if let Some(stdout) = child.stdout.take() {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(_)) = lines.next_line().await {}
        });
    }
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(_)) = lines.next_line().await {}
        });
    }
}

async fn caddy_load(admin_addr: &str, caddyfile: &str) -> Result<()> {
    let mut stream = TcpStream::connect(admin_addr).await.map_err(|error| {
        RuntimeError::Unavailable(format!("Caddy admin API unreachable: {error}"))
    })?;
    let body = caddyfile.as_bytes();
    // Caddy's admin API rejects requests whose Host header isn't in its
    // (CSRF-style) allowed-origins list, which defaults to the admin
    // listener's own address/port — not a bare "localhost" without a port.
    let request = format!(
        "POST /load?config_adapter=caddyfile HTTP/1.1\r\nHost: {admin_addr}\r\nContent-Type: text/caddyfile\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream
        .write_all(request.as_bytes())
        .await
        .map_err(RuntimeError::internal)?;
    stream
        .write_all(body)
        .await
        .map_err(RuntimeError::internal)?;
    let mut response = Vec::new();
    tokio::io::AsyncReadExt::read_to_end(&mut stream, &mut response)
        .await
        .map_err(RuntimeError::internal)?;
    let status_line = String::from_utf8_lossy(&response);
    let status = status_line
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| RuntimeError::Internal("invalid Caddy admin API response".into()))?;
    if !(200..300).contains(&status) {
        return Err(RuntimeError::Internal(format!(
            "Caddy admin API /load failed with HTTP {status}: {}",
            status_line.trim()
        )));
    }
    Ok(())
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
        Ok(value) => super::firecracker::parse_duration(&value)
            .ok_or_else(|| RuntimeError::BadRequest(format!("parse {name}: invalid duration"))),
        Err(std::env::VarError::NotPresent) => Ok(fallback),
        Err(error) => Err(RuntimeError::BadRequest(format!("read {name}: {error}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        USER_SUFFIX_LEN, branch_pattern, linux_user_for, linux_user_process_command,
        orca_serve_command_line, orca_serve_sudo_command, repository_pattern, shell_quote,
        token_pattern,
    };
    use std::path::Path;

    #[test]
    fn derives_a_stable_short_linux_username() {
        let user = linux_user_for("e010bd2c-a3c1-438f-acef-166287a3b1cb");
        assert_eq!(user, "orca-ws-e010bd2ca3c1438facef");
        assert_eq!(user.len(), "orca-ws-".len() + USER_SUFFIX_LEN);
        assert!(user.len() <= 32);
    }

    #[test]
    fn quotes_shell_arguments_defensively() {
        assert_eq!(
            shell_quote("/srv/codev/workspaces/x"),
            "'/srv/codev/workspaces/x'"
        );
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
    }

    #[test]
    fn gives_workspace_agents_a_writable_global_npm_prefix() {
        let command = orca_serve_command_line(
            Path::new("/opt/orca/AppRun"),
            "orca-ws-e010bd2ca3c1438facef",
            ":99",
            17_000,
            "https://host.example/w/workspace-id",
            Path::new("/srv/codev/workspaces/workspace-id"),
        );

        assert!(
            command.contains("NPM_CONFIG_PREFIX='/home/orca-ws-e010bd2ca3c1438facef/.npm-global'")
        );
        assert!(command.contains(
            "PATH='/home/orca-ws-e010bd2ca3c1438facef/.npm-global/bin:/usr/local/bin:/usr/bin:/bin'"
        ));
        assert!(command.contains("'/opt/orca/AppRun' --serve"));
    }

    #[test]
    fn never_puts_a_linked_credential_in_the_logged_sudo_command() {
        // sudo logs its own full argv to the system journal (confirmed: a
        // real Claude OAuth token leaked this way when it was embedded as
        // `env NAME='value'` in the shell string). The secret must only
        // ever travel through the child process's environment, passed via
        // --preserve-env=NAME (which logs only the variable's name) and
        // Command::env (never argv), never as literal text anywhere in the
        // command that gets run or logged.
        let secret = "sk-ant-oat01-super-secret-value";
        let command = orca_serve_sudo_command(
            Path::new("/opt/orca/AppRun"),
            "orca-ws-e010bd2ca3c1438facef",
            ":99",
            17_000,
            "https://host.example/w/workspace-id",
            Path::new("/srv/codev/workspaces/workspace-id"),
            Some(("CLAUDE_CODE_OAUTH_TOKEN", secret)),
        );
        let std_command = command.as_std();

        for arg in std_command.get_args() {
            assert!(
                !arg.to_string_lossy().contains(secret),
                "credential leaked into a logged sudo argument: {arg:?}"
            );
        }
        assert!(
            std_command
                .get_args()
                .any(|arg| arg == "--preserve-env=CLAUDE_CODE_OAUTH_TOKEN"),
            "expected --preserve-env to forward the credential by name"
        );
        assert_eq!(
            std_command
                .get_envs()
                .find(|(name, _)| *name == "CLAUDE_CODE_OAUTH_TOKEN")
                .and_then(|(_, value)| value),
            Some(secret.as_ref()),
            "expected the credential to be set via the environment, not argv"
        );
    }

    #[test]
    fn scopes_process_cleanup_to_the_workspace_linux_user() {
        let command = linux_user_process_command("pkill", "orca-ws-e010bd2ca3c1438facef");
        assert_eq!(command.as_std().get_program(), "pkill");
        assert_eq!(
            command.as_std().get_args().collect::<Vec<_>>(),
            ["-u", "orca-ws-e010bd2ca3c1438facef"]
        );
    }

    #[test]
    fn validates_clone_request_fields() {
        assert!(repository_pattern().is_match("stablyai/orca"));
        assert!(!repository_pattern().is_match("../etc/passwd"));
        assert!(!repository_pattern().is_match("stablyai/orca; rm -rf /"));

        assert!(branch_pattern().is_match("main"));
        assert!(branch_pattern().is_match("feature/x-1"));
        assert!(!branch_pattern().is_match("feature; rm -rf /"));

        assert!(token_pattern().is_match("ghp_abcDEF0123456789"));
        assert!(!token_pattern().is_match("token with spaces"));
    }
}
