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
            // A shared workspace runs one session, but each member's coding
            // subscription is their own. Re-file this member's credentials on
            // every open — including this join-an-existing-session path, which
            // is the *only* path a second member ever takes — so an agent they
            // launch runs on their subscription instead of whichever member
            // started the session. Best-effort: a member with nothing linked
            // (or a rotated credential) must never fail the open.
            if let Err(error) =
                write_member_agent_credentials(&linux_user_for(workspace_id), &request).await
            {
                warn!(
                    workspace_id,
                    %error, "could not file this member's agent credentials"
                );
            }
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
        seed_claude_config(&linux_user, &expected_root).await?;
        // Also file them per-member, so the member who starts the session gets
        // the same per-subscription treatment as everyone who joins later.
        if let Err(error) = write_member_agent_credentials(&linux_user, &request).await {
            warn!(workspace_id, %error, "could not file this member's agent credentials");
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

/// Directory holding one CoDev member's own agent credentials inside the
/// shared per-workspace Linux home.
fn member_agent_dir(linux_user: &str, member_id: &str) -> PathBuf {
    PathBuf::from(format!("/home/{linux_user}/.codev/agents/{member_id}"))
}

/// A CoDev member id as minted by the control plane (a UUID). Validated
/// before it reaches the filesystem so it can only ever name a direct child of
/// the agents directory — never `..`, an absolute path, or a separator.
fn member_id_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
            .expect("member id regex")
    })
}

/// The environment every CLI agent this member launches is spawned with,
/// serialized to their `env.json`. Each key is the sign-in the matching CLI
/// would otherwise prompt for interactively — a prompt the native-chat
/// surface cannot answer, so a missing key there is the whole "agent produces
/// nothing" failure.
///
/// `codex_home` is `Some` once the caller has materialized a hosted Codex
/// subscription's config dir; its presence also suppresses the plain
/// `OPENAI_API_KEY` fallback so the two never fight over the Codex CLI.
fn member_agent_env_map(
    request: &IdeStartRequest,
    codex_home: Option<&Path>,
) -> serde_json::Map<String, Value> {
    let mut env = serde_json::Map::new();

    if let Some(codex_home) = codex_home {
        env.insert(
            "CODEX_HOME".to_string(),
            Value::String(codex_home.to_string_lossy().into_owned()),
        );
    }

    // Claude Code takes its credential from the environment rather than a
    // config file. At most one of the two forms is ever present.
    if let Some(api_key) = &request.anthropic_api_key {
        env.insert(
            "ANTHROPIC_API_KEY".to_string(),
            Value::String(api_key.clone()),
        );
    } else if let Some(token) = &request.claude_code_oauth_token {
        env.insert(
            "CLAUDE_CODE_OAUTH_TOKEN".to_string(),
            Value::String(token.clone()),
        );
    }

    // The Cursor CLI has no config directory to seed the way Codex does; it
    // reads its key straight from the environment.
    if let Some(cursor_api_key) = &request.cursor_api_key {
        env.insert(
            "CURSOR_API_KEY".to_string(),
            Value::String(cursor_api_key.clone()),
        );
    }

    // A plain OpenAI API key is the API-key fallback for the Codex CLI when
    // the member has no hosted Codex subscription.
    if codex_home.is_none()
        && let Some(openai_api_key) = &request.openai_api_key
    {
        env.insert(
            "OPENAI_API_KEY".to_string(),
            Value::String(openai_api_key.clone()),
        );
    }

    env
}

/// Files one member's linked coding-subscription credentials under their own
/// id, so an agent they launch in a shared workspace runs on *their*
/// subscription.
///
/// A workspace runs a single `orca serve` as a single Linux user, so the
/// credential cannot be an environment variable on that shared process (it
/// would be whichever member started the session, for everybody). Instead each
/// member gets a directory here, and the IDE's main process merges the
/// launching member's `env.json` into that agent's PTY spawn — see
/// `packages/ide/CODEV-INTEGRATION.md`. The control plane sends only a member id
/// through the browser; the secret itself never leaves the host.
///
/// This is per-member *attribution*, not a security boundary: members share
/// one Linux user, so this stops a member from unknowingly spending someone
/// else's subscription, but does not stop a determined one from reading the
/// files. Isolating that needs a Linux user per member.
async fn write_member_agent_credentials(linux_user: &str, request: &IdeStartRequest) -> Result<()> {
    let Some(member_id) = request.member_id.as_deref() else {
        return Ok(());
    };
    if !member_id_pattern().is_match(member_id) {
        return Err(RuntimeError::BadRequest("member id is malformed".into()));
    }

    let member_dir = member_agent_dir(linux_user, member_id);
    fs::create_dir_all(&member_dir)
        .await
        .map_err(RuntimeError::internal)?;

    // Codex reads its whole config directory from CODEX_HOME, so a linked
    // hosted subscription gets its own materialized here; every other agent
    // takes its credential straight from env.json.
    let mut codex_home: Option<PathBuf> = None;
    if let Some(codex_auth_cache_json) = &request.codex_auth_cache_json {
        let home = member_dir.join("codex");
        fs::create_dir_all(&home)
            .await
            .map_err(RuntimeError::internal)?;
        let auth_path = home.join("auth.json");
        fs::write(&auth_path, codex_auth_cache_json)
            .await
            .map_err(RuntimeError::internal)?;
        fs::set_permissions(&auth_path, std::fs::Permissions::from_mode(0o600))
            .await
            .map_err(RuntimeError::internal)?;
        codex_home = Some(home);
    }

    let env = member_agent_env_map(request, codex_home.as_deref());

    let env_path = member_dir.join("env.json");
    if env.is_empty() {
        // This member has nothing linked. Remove any bundle from a previous
        // link so a revoked credential stops being handed to their agents,
        // rather than leaving the last one that worked in place.
        match fs::remove_file(&env_path).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(RuntimeError::internal(error)),
        }
    } else {
        let serialized = serde_json::to_vec(&Value::Object(env)).map_err(RuntimeError::internal)?;
        fs::write(&env_path, serialized)
            .await
            .map_err(RuntimeError::internal)?;
        fs::set_permissions(&env_path, std::fs::Permissions::from_mode(0o600))
            .await
            .map_err(RuntimeError::internal)?;
    }

    fs::set_permissions(&member_dir, std::fs::Permissions::from_mode(0o700))
        .await
        .map_err(RuntimeError::internal)?;
    chown_recursive(&member_dir, linux_user).await
}

/// Seeds the Claude Code CLI's own config so the interactive session Orca
/// launches into the workspace's default chat tab starts *ready*, instead of
/// blocking on the first-run wizard (theme picker, then the per-directory
/// "trust the files in this folder?" prompt) that the native chat surface
/// cannot drive.
///
/// Two files, because the CLI splits them (verified against Claude Code
/// v2.1.236's own on-disk state):
/// - `~/.claude.json` — `hasCompletedOnboarding` and the per-project
///   `hasTrustDialogAccepted` under `projects`.
/// - `~/.claude/settings.json` — `theme`.
///
/// Both are merged non-destructively, so a member who later runs `claude` in a
/// terminal and changes their own settings keeps them. The auth step of
/// onboarding is already skipped by the `ANTHROPIC_API_KEY` /
/// `CLAUDE_CODE_OAUTH_TOKEN` env var set at spawn.
///
/// `bypassPermissionsModeAccepted` is seeded too. Standing alone that would be
/// a security decision rather than a first-run annoyance — but Orca already
/// launches every Claude agent with `--dangerously-skip-permissions`
/// unconditionally (`agentDefaultArgs` in `src/shared/constants.ts`, "yolo
/// mode where the CLI supports it"), so the bypass is in force either way and
/// withholding the acceptance only strands the CLI on a consent prompt the
/// chat surface cannot answer. The workspace is precisely the isolated
/// container the CLI's own warning asks for: a dedicated Linux user, in a
/// per-workspace clone, on a disposable cloud host.
async fn seed_claude_config(user: &str, project_root: &Path) -> Result<()> {
    let home = PathBuf::from(format!("/home/{user}"));

    let config_path = home.join(".claude.json");
    let config = claude_config_with_onboarding_skipped(
        read_optional_json_object(&config_path).await?,
        project_root,
    );
    write_private_json(&config_path, &config, user).await?;

    let settings_dir = home.join(".claude");
    fs::create_dir_all(&settings_dir)
        .await
        .map_err(RuntimeError::internal)?;
    let settings_path = settings_dir.join("settings.json");
    let settings = claude_settings_with_theme(read_optional_json_object(&settings_path).await?);
    write_private_json(&settings_path, &settings, user).await?;
    chown_recursive(&settings_dir, user).await
}

/// Reads a JSON object from `path`, treating both "absent" and "not valid JSON
/// object" as "nothing to merge onto" rather than an error — a corrupt config
/// must not stop the workspace from starting.
async fn read_optional_json_object(path: &Path) -> Result<Option<Value>> {
    match fs::read(path).await {
        Ok(bytes) => Ok(serde_json::from_slice::<Value>(&bytes)
            .ok()
            .filter(Value::is_object)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(RuntimeError::internal(error)),
    }
}

async fn write_private_json(path: &Path, value: &Value, user: &str) -> Result<()> {
    let serialized = serde_json::to_vec(value).map_err(RuntimeError::internal)?;
    fs::write(path, serialized)
        .await
        .map_err(RuntimeError::internal)?;
    fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .await
        .map_err(RuntimeError::internal)?;
    chown_recursive(path, user).await
}

/// Merges the first-run-skipping keys onto an existing `~/.claude.json` (or a
/// fresh object when there is none). `hasCompletedOnboarding` uses
/// `entry().or_insert` so a member's own value survives, but the per-project
/// `hasTrustDialogAccepted` is forced: it gates an interactive prompt CoDev's
/// chat surface can never answer, and the workspace clone is CoDev's own
/// directory, not arbitrary third-party content.
fn claude_config_with_onboarding_skipped(existing: Option<Value>, project_root: &Path) -> Value {
    let mut config = existing.unwrap_or_else(|| serde_json::json!({}));
    let root = config
        .as_object_mut()
        .expect("existing is filtered to objects; default is an object");

    root.entry("hasCompletedOnboarding")
        .or_insert(Value::Bool(true));
    root.entry("bypassPermissionsModeAccepted")
        .or_insert(Value::Bool(true));

    let projects = root
        .entry("projects")
        .or_insert_with(|| serde_json::json!({}));
    if let Some(projects) = projects.as_object_mut() {
        let entry = projects
            .entry(project_root.to_string_lossy().into_owned())
            .or_insert_with(|| serde_json::json!({}));
        if let Some(entry) = entry.as_object_mut() {
            entry.insert("hasTrustDialogAccepted".to_string(), Value::Bool(true));
        }
    }

    config
}

/// Merges CoDev's default theme onto an existing `~/.claude/settings.json`.
/// Only applied when the member has no theme of their own — unlike the trust
/// flag this is purely a preference, and the workspace chrome around it is
/// dark.
fn claude_settings_with_theme(existing: Option<Value>) -> Value {
    let mut settings = existing.unwrap_or_else(|| serde_json::json!({}));
    settings
        .as_object_mut()
        .expect("existing is filtered to objects; default is an object")
        .entry("theme")
        .or_insert_with(|| Value::String("dark".to_string()));
    settings
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
        USER_SUFFIX_LEN, branch_pattern, claude_config_with_onboarding_skipped,
        claude_settings_with_theme, linux_user_for, linux_user_process_command, member_agent_dir,
        member_agent_env_map, member_id_pattern, orca_serve_command_line, orca_serve_sudo_command,
        repository_pattern, shell_quote, token_pattern,
    };
    use crate::model::IdeStartRequest;
    use serde_json::json;

    fn ide_start_request(extra: serde_json::Value) -> IdeStartRequest {
        let mut body = json!({
            "projectRoot": "/srv/codev/workspaces/w",
            "memberId": "11111111-1111-4111-8111-111111111111",
        });
        body.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        serde_json::from_value(body).expect("valid IdeStartRequest")
    }
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

    #[test]
    fn seeds_a_ready_claude_config_when_none_exists() {
        let root = Path::new("/srv/codev/workspaces/w");
        let config = claude_config_with_onboarding_skipped(None, root);

        assert_eq!(config["hasCompletedOnboarding"], json!(true));
        assert_eq!(
            config["projects"]["/srv/codev/workspaces/w"]["hasTrustDialogAccepted"],
            json!(true)
        );
        // Orca launches Claude with --dangerously-skip-permissions regardless,
        // so the consent prompt is pure friction; accept it up front.
        assert_eq!(config["bypassPermissionsModeAccepted"], json!(true));
        // The theme lives in ~/.claude/settings.json, not here.
        assert!(config.get("theme").is_none());
    }

    #[test]
    fn keeps_a_members_own_claude_config_but_forces_project_trust() {
        let root = Path::new("/srv/codev/workspaces/w");
        let existing = json!({
            "hasCompletedOnboarding": true,
            "customThing": 7,
            "projects": {
                "/srv/codev/workspaces/w": { "hasTrustDialogAccepted": false, "note": "keep" },
                "/some/other/project": { "hasTrustDialogAccepted": false }
            }
        });

        let config = claude_config_with_onboarding_skipped(Some(existing), root);

        assert_eq!(config["customThing"], json!(7));
        let project = &config["projects"]["/srv/codev/workspaces/w"];
        assert_eq!(project["hasTrustDialogAccepted"], json!(true));
        assert_eq!(project["note"], json!("keep"));
        // Only this workspace's clone is trusted on the member's behalf.
        assert_eq!(
            config["projects"]["/some/other/project"]["hasTrustDialogAccepted"],
            json!(false)
        );
    }

    #[test]
    fn files_each_member_agent_bundle_under_its_own_id() {
        let alice = "11111111-1111-4111-8111-111111111111";
        let bob = "22222222-2222-4222-8222-222222222222";
        assert_eq!(
            member_agent_dir("orca-ws-abc", alice),
            Path::new("/home/orca-ws-abc/.codev/agents/11111111-1111-4111-8111-111111111111")
        );
        // Two members of one shared workspace never share a bundle directory.
        assert_ne!(
            member_agent_dir("orca-ws-abc", alice),
            member_agent_dir("orca-ws-abc", bob)
        );
    }

    #[test]
    fn refuses_a_member_id_that_could_escape_the_agents_directory() {
        assert!(member_id_pattern().is_match("11111111-1111-4111-8111-111111111111"));
        for hostile in [
            "../../etc",
            "/etc/passwd",
            "11111111-1111-4111-8111-111111111111/../../root",
            "",
            "not-a-uuid",
        ] {
            assert!(
                !member_id_pattern().is_match(hostile),
                "should reject {hostile}"
            );
        }
    }

    #[test]
    fn files_a_linked_cursor_key_so_the_cli_starts_authenticated() {
        // The interactive `cursor-agent` had no credential written for it at
        // all, so the native-chat Cursor agent always stranded on sign-in.
        let request = ide_start_request(json!({ "cursorApiKey": "key_cursor_abc123" }));
        let env = member_agent_env_map(&request, None);
        assert_eq!(env["CURSOR_API_KEY"], json!("key_cursor_abc123"));
    }

    #[test]
    fn falls_back_to_a_plain_openai_key_only_without_a_hosted_codex_home() {
        let request = ide_start_request(json!({ "openaiApiKey": "sk-openai-xyz" }));

        // No hosted subscription: the plain key is the Codex CLI's auth.
        let env = member_agent_env_map(&request, None);
        assert_eq!(env["OPENAI_API_KEY"], json!("sk-openai-xyz"));

        // Hosted subscription present: CODEX_HOME wins, the plain key is not
        // also set so the two can't disagree about which account Codex uses.
        let with_home =
            member_agent_env_map(&request, Some(Path::new("/home/u/.codev/agents/m/codex")));
        assert_eq!(
            with_home["CODEX_HOME"],
            json!("/home/u/.codev/agents/m/codex")
        );
        assert!(!with_home.contains_key("OPENAI_API_KEY"));
    }

    #[test]
    fn nothing_linked_yields_an_empty_bundle_that_clears_a_stale_one() {
        assert!(member_agent_env_map(&ide_start_request(json!({})), None).is_empty());
    }

    #[test]
    fn seeds_the_dark_theme_only_when_the_member_has_none() {
        assert_eq!(claude_settings_with_theme(None)["theme"], json!("dark"));

        let chosen = claude_settings_with_theme(Some(json!({ "theme": "light", "model": "opus" })));
        assert_eq!(chosen["theme"], json!("light"));
        assert_eq!(chosen["model"], json!("opus"));
    }
}
