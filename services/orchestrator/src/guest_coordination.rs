use std::{fs::File, io::Read, path::Path};

use sha2::{Digest, Sha256};

pub(crate) const COORDINATION_AGENTS_PATH: &str = "/codev/coordination/agents";
const COORDINATION_NOTICES_URL: &str = "http://127.0.0.1:4879/codev/coordination/notices";

/// A native turn's identity for the host's coordination hook. The host stores
/// only the token's hash; the token reaches nothing but the turn's own
/// environment, where its PostToolUse hook presents it.
pub(crate) struct CoordinationAgent {
    id: String,
    token: String,
    harness: &'static str,
    worktree_id: String,
}

fn harness_for(program: &str) -> Option<&'static str> {
    match Path::new(program).file_name()?.to_str()? {
        "codex" => Some("codex"),
        "claude" => Some("claude"),
        "cursor-agent" => Some("cursor"),
        _ => None,
    }
}

fn random_hex(bytes: usize) -> Option<String> {
    let mut buffer = vec![0_u8; bytes];
    File::open("/dev/urandom")
        .ok()?
        .read_exact(&mut buffer)
        .ok()?;
    Some(hex::encode(buffer))
}

impl CoordinationAgent {
    pub(crate) fn new(program: &str, worktree_id: Option<&str>) -> Option<Self> {
        Some(Self {
            harness: harness_for(program)?,
            id: format!("native-{}", random_hex(8)?),
            token: random_hex(32)?,
            worktree_id: worktree_id.unwrap_or("main").to_string(),
        })
    }

    pub(crate) fn registration(&self) -> Vec<u8> {
        serde_json::json!({
            "agentId": self.id,
            "worktreeId": self.worktree_id,
            "harness": self.harness,
            "tokenHash": hex::encode(Sha256::digest(self.token.as_bytes())),
        })
        .to_string()
        .into_bytes()
    }

    pub(crate) fn release_path(&self) -> String {
        format!("{COORDINATION_AGENTS_PATH}/{}", self.id)
    }

    pub(crate) fn environment(&self) -> [(&'static str, &str); 3] {
        [
            ("CODEV_COORDINATION_URL", COORDINATION_NOTICES_URL),
            ("CODEV_COORDINATION_AGENT_ID", &self.id),
            ("CODEV_COORDINATION_TOKEN", &self.token),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::CoordinationAgent;

    #[test]
    fn identifies_only_supported_agent_clis() {
        for (program, harness) in [
            ("codex", "codex"),
            ("/usr/local/bin/claude", "claude"),
            ("cursor-agent", "cursor"),
        ] {
            assert_eq!(
                CoordinationAgent::new(program, None).map(|agent| agent.harness),
                Some(harness)
            );
        }
        assert!(CoordinationAgent::new("bash", None).is_none());
        assert!(CoordinationAgent::new("codex-wrapper", None).is_none());
    }

    #[test]
    fn registers_a_hash_and_keeps_the_token_in_the_turn_environment() {
        let agent = CoordinationAgent::new("cursor-agent", Some("fix-auth")).expect("agent");
        let registration: serde_json::Value =
            serde_json::from_slice(&agent.registration()).expect("registration json");

        assert!(agent.id.starts_with("native-") && agent.id.len() == 23);
        assert_eq!(agent.token.len(), 64);
        assert_eq!(registration["worktreeId"], "fix-auth");
        assert_eq!(registration["harness"], "cursor");
        assert_eq!(registration["tokenHash"].as_str().map(str::len), Some(64));
        assert!(
            !String::from_utf8(agent.registration())
                .unwrap()
                .contains(&agent.token)
        );
        assert_eq!(
            agent.release_path(),
            format!("/codev/coordination/agents/{}", agent.id)
        );
        assert_eq!(
            agent.environment()[2],
            ("CODEV_COORDINATION_TOKEN", agent.token.as_str())
        );
    }

    #[test]
    fn coordinates_only_turns_codev_opted_in() {
        let request = |extra: &str| -> crate::model::CodexExecStartRequest {
            serde_json::from_str(&format!(
                r#"{{"command":["cursor-agent"],"idempotencyKey":"key"{extra}}}"#
            ))
            .expect("request")
        };
        assert!(!request("").coordination);
        assert!(request(r#","coordination":true"#).coordination);
    }

    #[test]
    fn defaults_to_the_primary_worktree() {
        let agent = CoordinationAgent::new("codex", None).expect("agent");
        let registration: serde_json::Value =
            serde_json::from_slice(&agent.registration()).expect("registration json");
        assert_eq!(registration["worktreeId"], "main");
    }
}
