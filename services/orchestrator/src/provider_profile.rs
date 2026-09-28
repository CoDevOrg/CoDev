//! Per-launch provider credential profiles for Superset-launched agent
//! sessions, per `docs/SUPERSET_AGENT_SESSION_PLAN.md` Phase 2.
//!
//! `codev-guestd` runs under `ProtectSystem=strict` + `PrivateTmp=true`
//! (see `infra/runtime/scripts/bootstrap-host.sh`), so its own `/tmp` is a
//! private mount namespace no other guest service can see -- including
//! Superset's host-service, which has its own separate, explicitly
//! declared `/var/lib/codev-superset` (`SUPERSET_HOME_DIR`) and no
//! visibility into guestd's `/tmp`. A profile materialized under
//! `std::env::temp_dir()` here is therefore already outside `/workspace`
//! and outside Superset's shared home without inventing a new writable
//! path (which `ProtectSystem=strict` would otherwise block until the
//! guestd systemd unit's `ReadWritePaths` was extended). This generalizes
//! the existing `TemporaryCodexHome` pattern in `guest.rs` -- same
//! directory root, same 0700/0600 permissions, same `Drop`-based cleanup --
//! into a provider-agnostic profile a caller can hold by handle across a
//! launch, rather than only across one `exec` call's stack frame.
//!
//! This module is not yet wired into `GuestService`: Phase 3 adds the
//! Superset launch endpoint that will actually create a profile from a
//! resolved connection, hand Superset its handle, and resolve that handle
//! back into a launch environment. Until then this is reviewable and
//! testable on its own.

use std::{
    collections::HashMap,
    fs, io,
    os::unix::fs::PermissionsExt,
    path::{Component, Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

/// The guest's fixed, unprivileged `PATH` -- mirrors `GUEST_PATH` in
/// `guest.rs`. Duplicated rather than imported so this module has no
/// compile-time dependency on that file's private items.
const PROFILE_PATH: &str = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/// Which provider a launch recipe targets. Only Codex's official
/// auth-cache format is implemented, per the plan's "Start with the
/// existing Codex official auth-cache format." Add a variant here, and a
/// constructor alongside `ProviderLaunchRecipe::codex`, for the next
/// provider.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProviderKind {
    Codex,
}

impl ProviderKind {
    fn label(self) -> &'static str {
        match self {
            ProviderKind::Codex => "codex",
        }
    }
}

/// Where, inside a profile, the launched process's provider credential
/// lives, and where to read it back from once the process has exited (or
/// at a defined safe checkpoint) so CoDev can persist a refreshed token.
/// Phase 5 owns the actual persistence; this only names the file.
#[derive(Clone, Debug)]
pub struct RefreshCollector {
    /// Path relative to the profile directory.
    pub relative_path: String,
}

impl RefreshCollector {
    fn codex() -> Self {
        Self {
            relative_path: "auth.json".to_string(),
        }
    }
}

/// An opaque reference to a live `ProviderProfile`, unique within this
/// guestd process's lifetime -- a profile never outlives the process that
/// materialized it, so a handle never needs to survive a restart. This,
/// not a raw path or credential payload, is what a caller passes on in a
/// Superset launch request; see `docs/SUPERSET_AGENT_SESSION_PLAN.md`
/// Phase 3's "guest should pass Superset a profile handle ... not a raw
/// credential payload in a general host request."
#[derive(Clone, Debug, Eq, PartialEq, Hash)]
pub struct ProfileHandle(String);

impl ProfileHandle {
    fn new(kind: ProviderKind, seed: u64) -> Self {
        Self(format!(
            "profile-{}-{}-{seed:x}",
            kind.label(),
            std::process::id()
        ))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A materialized, run-scoped, filesystem-backed credential profile: a
/// fresh 0700 directory containing only the files one launched process
/// needs, removed on drop.
pub struct ProviderProfile {
    dir: PathBuf,
    #[allow(dead_code)]
    kind: ProviderKind,
}

impl ProviderProfile {
    fn create(kind: ProviderKind, seed: u64) -> io::Result<Self> {
        let dir = std::env::temp_dir().join(format!(
            "codev-profile-{}-{}-{seed:x}",
            kind.label(),
            std::process::id()
        ));
        fs::create_dir(&dir)?;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))?;
        Ok(Self { dir, kind })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Writes one credential file into the profile at 0600, matching the
    /// existing Codex auth-cache handling in `guest.rs`.
    pub fn write_credential(&self, relative_path: &str, contents: &[u8]) -> io::Result<()> {
        let path = self.credential_path(relative_path)?;
        fs::write(&path, contents)?;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
    }

    /// Reads a credential file back out, for the refresh capture Phase 5
    /// describes. `Ok(None)` means the launched process never wrote one --
    /// not every provider run refreshes its credential.
    pub fn read_credential(&self, relative_path: &str) -> io::Result<Option<Vec<u8>>> {
        let path = self.credential_path(relative_path)?;
        match fs::read(&path) {
            Ok(contents) => Ok(Some(contents)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// Rejects an absolute path or one with a `..`/root component that
    /// could escape the profile directory -- the same defense-in-depth
    /// guard the workspace file routes apply elsewhere in this crate.
    fn credential_path(&self, relative_path: &str) -> io::Result<PathBuf> {
        let candidate = Path::new(relative_path);
        let escapes = candidate.components().any(|component| {
            !matches!(component, Component::Normal(part) if !part.is_empty())
        });
        if candidate.as_os_str().is_empty() || escapes {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "credential path must be a single relative path within the profile",
            ));
        }
        Ok(self.dir.join(candidate))
    }
}

impl Drop for ProviderProfile {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

/// The provider kind, executable, arguments, environment, profile, and
/// refresh instructions a Superset launch request needs, per
/// `docs/SUPERSET_AGENT_SESSION_PLAN.md` Phase 2's "internal provider
/// launch recipe interface." No secret lives on this type: `env` holds
/// only the fixed, provider-specific variable names this recipe allows
/// through -- never the launched process's full inherited environment, per
/// the plan's "Disable Superset default accounts and all host-wide
/// provider environment for these sessions" -- and every value is derived
/// from the profile directory at build time, not carried as an opaque
/// string a caller could echo back into CoDev's durable run mapping or the
/// browser.
pub struct ProviderLaunchRecipe {
    pub kind: ProviderKind,
    pub executable: String,
    pub args: Vec<String>,
    pub profile: ProfileHandle,
    pub refresh: RefreshCollector,
    env: HashMap<String, String>,
}

impl ProviderLaunchRecipe {
    /// The only implemented recipe today: `codex exec`, authenticated from
    /// the profile's `auth.json` via `CODEX_HOME`, matching the
    /// materialization already used in `guest.rs`'s `TemporaryCodexHome`
    /// path.
    pub fn codex(profile: &ProviderProfile, handle: ProfileHandle, args: Vec<String>) -> Self {
        let mut env = HashMap::new();
        env.insert("CODEX_HOME".to_string(), profile.dir().display().to_string());
        env.insert("PATH".to_string(), PROFILE_PATH.to_string());
        Self {
            kind: ProviderKind::Codex,
            executable: "codex".to_string(),
            args,
            profile: handle,
            refresh: RefreshCollector::codex(),
            env,
        }
    }

    /// The fixed set of environment variable names this recipe allows
    /// through to the launched process.
    pub fn env_names(&self) -> impl Iterator<Item = &str> {
        self.env.keys().map(String::as_str)
    }

    /// The full launch environment: exactly `env_names()`, each mapped to
    /// its resolved value. Internal to the guest/host launch path -- never
    /// serialized into a browser response or CoDev's durable run mapping.
    pub fn env(&self) -> &HashMap<String, String> {
        &self.env
    }
}

/// Registry of this guestd process's live profiles, keyed by handle.
#[derive(Default)]
pub struct ProviderProfileRegistry {
    profiles: Mutex<HashMap<ProfileHandle, (Instant, Arc<ProviderProfile>)>>,
    sequence: AtomicU64,
}

impl ProviderProfileRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Materializes a fresh profile holding one credential file and
    /// returns its handle. The profile itself stays in this registry, not
    /// returned, so only the handle -- never a raw path -- needs to cross
    /// into a Superset launch request.
    pub fn materialize(
        &self,
        kind: ProviderKind,
        relative_path: &str,
        credential: &[u8],
    ) -> io::Result<ProfileHandle> {
        let seed = self.sequence.fetch_add(1, Ordering::Relaxed);
        let profile = ProviderProfile::create(kind, seed)?;
        profile.write_credential(relative_path, credential)?;
        let handle = ProfileHandle::new(kind, seed);
        self.profiles
            .lock()
            .expect("profile registry lock")
            .insert(handle.clone(), (Instant::now(), Arc::new(profile)));
        Ok(handle)
    }

    /// Looks up a live profile by handle. `None` for an unknown or
    /// already-removed handle -- a stale handle from a retried or
    /// duplicate request must fail closed, not resolve to nothing and
    /// silently skip the credential.
    pub fn get(&self, handle: &ProfileHandle) -> Option<Arc<ProviderProfile>> {
        self.profiles
            .lock()
            .expect("profile registry lock")
            .get(handle)
            .map(|(_, profile)| profile.clone())
    }

    /// Removes and drops a profile, deleting its directory. Call after
    /// final credential capture, on cancellation, on a failed launch, or
    /// from `reap_older_than` for anything a VM restart left behind.
    pub fn remove(&self, handle: &ProfileHandle) {
        self.profiles.lock().expect("profile registry lock").remove(handle);
    }

    /// Removes every profile materialized more than `max_age` ago --
    /// backstop cleanup for "VM cleanup, or expired recovery window" in
    /// the plan, independent of any caller ever explicitly removing a
    /// handle.
    pub fn reap_older_than(&self, max_age: Duration) {
        let now = Instant::now();
        self.profiles
            .lock()
            .expect("profile registry lock")
            .retain(|_, (created_at, _)| now.duration_since(*created_at) < max_age);
    }

    pub fn is_empty(&self) -> bool {
        self.profiles.lock().expect("profile registry lock").is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn materializes_a_private_run_scoped_profile() {
        let registry = ProviderProfileRegistry::new();
        let handle = registry
            .materialize(ProviderKind::Codex, "auth.json", br#"{"tokens":{}}"#)
            .expect("materialize");
        let profile = registry.get(&handle).expect("profile present");

        let mode = fs::metadata(profile.dir())
            .expect("dir metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o700);
        let file_mode = fs::metadata(profile.dir().join("auth.json"))
            .expect("file metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(file_mode, 0o600);
        assert_eq!(
            fs::read(profile.dir().join("auth.json")).expect("read"),
            br#"{"tokens":{}}"#
        );
    }

    #[test]
    fn an_unknown_handle_resolves_to_nothing_rather_than_a_default() {
        let registry = ProviderProfileRegistry::new();
        let bogus = ProfileHandle::new(ProviderKind::Codex, 999);
        assert!(registry.get(&bogus).is_none());
    }

    #[test]
    fn removing_a_profile_deletes_its_directory() {
        let registry = ProviderProfileRegistry::new();
        let handle = registry
            .materialize(ProviderKind::Codex, "auth.json", b"{}")
            .expect("materialize");
        let dir = registry.get(&handle).expect("profile").dir().to_path_buf();
        assert!(dir.exists());

        registry.remove(&handle);
        assert!(registry.get(&handle).is_none());
        assert!(registry.is_empty());
        assert!(!dir.exists());
    }

    #[test]
    fn a_recipe_carries_only_the_credential_path_never_its_contents_as_an_opaque_string() {
        let registry = ProviderProfileRegistry::new();
        let handle = registry
            .materialize(ProviderKind::Codex, "auth.json", br#"{"tokens":{"a":1}}"#)
            .expect("materialize");
        let profile = registry.get(&handle).expect("profile");
        let recipe = ProviderLaunchRecipe::codex(&profile, handle, vec!["exec".into()]);

        assert_eq!(recipe.env()["CODEX_HOME"], profile.dir().display().to_string());
        assert!(recipe.env_names().collect::<Vec<_>>().contains(&"PATH"));
        // The recipe's environment is a directory reference, not the
        // credential itself.
        for value in recipe.env().values() {
            assert!(!value.contains("tokens"));
        }
    }

    #[test]
    fn rejects_a_credential_path_that_would_escape_the_profile() {
        let registry = ProviderProfileRegistry::new();
        let handle = registry
            .materialize(ProviderKind::Codex, "auth.json", b"{}")
            .expect("materialize");
        let profile = registry.get(&handle).expect("profile");

        assert!(profile.write_credential("../escape.json", b"{}").is_err());
        assert!(profile.write_credential("/etc/passwd", b"{}").is_err());
        assert!(profile.read_credential("../../etc/shadow").is_err());
    }

    #[test]
    fn reap_older_than_removes_only_stale_profiles() {
        let registry = ProviderProfileRegistry::new();
        let handle = registry
            .materialize(ProviderKind::Codex, "auth.json", b"{}")
            .expect("materialize");
        let dir = registry.get(&handle).expect("profile").dir().to_path_buf();

        // Not yet stale relative to a generous max age.
        registry.reap_older_than(Duration::from_secs(3600));
        assert!(registry.get(&handle).is_some());

        // Stale relative to a zero max age.
        registry.reap_older_than(Duration::from_secs(0));
        assert!(registry.get(&handle).is_none());
        assert!(!dir.exists());
    }

    #[test]
    fn a_run_never_reads_back_a_credential_that_was_not_written() {
        let registry = ProviderProfileRegistry::new();
        let handle = registry
            .materialize(ProviderKind::Codex, "auth.json", b"{}")
            .expect("materialize");
        let profile = registry.get(&handle).expect("profile");
        assert_eq!(profile.read_credential("refreshed.json").expect("read"), None);
    }
}
