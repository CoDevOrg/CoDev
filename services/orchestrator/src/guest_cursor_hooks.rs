use std::path::{Path, PathBuf};

/// Project files the Cursor CLI reads hooks from, with no flag to turn them
/// off. In a shared workspace any member can write them, and a hook runs with
/// the credentials of whichever member started the turn.
const CURSOR_PROJECT_HOOK_FILES: [&str; 3] = [
    ".cursor/hooks.json",
    ".claude/settings.json",
    ".claude/settings.local.json",
];

/// The first project hook file Cursor would load for a turn in `directories`,
/// counting dangling and directory entries too: only absence is safe.
pub(crate) fn cursor_project_hook_file(program: &str, directories: &[&Path]) -> Option<PathBuf> {
    if Path::new(program).file_name()?.to_str()? != "cursor-agent" {
        return None;
    }
    directories.iter().find_map(|directory| {
        CURSOR_PROJECT_HOOK_FILES
            .iter()
            .map(|file| directory.join(file))
            .find(|path| path.symlink_metadata().is_ok())
    })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::cursor_project_hook_file;

    #[test]
    fn finds_repository_hooks_only_for_cursor_turns() {
        let directory = tempfile::tempdir().expect("tempdir");
        fs::create_dir(directory.path().join(".claude")).expect("claude dir");
        fs::write(directory.path().join(".claude/settings.json"), "{}").expect("settings");

        assert_eq!(
            cursor_project_hook_file("/usr/local/bin/cursor-agent", &[directory.path()]),
            Some(directory.path().join(".claude/settings.json"))
        );
        assert!(cursor_project_hook_file("codex", &[directory.path()]).is_none());
        assert!(cursor_project_hook_file("claude", &[directory.path()]).is_none());
    }

    #[test]
    fn counts_dangling_links_and_checks_every_directory() {
        let clean = tempfile::tempdir().expect("clean");
        let planted = tempfile::tempdir().expect("planted");
        fs::create_dir(planted.path().join(".cursor")).expect("cursor dir");
        std::os::unix::fs::symlink("/missing", planted.path().join(".cursor/hooks.json"))
            .expect("link");

        assert!(cursor_project_hook_file("cursor-agent", &[clean.path()]).is_none());
        assert_eq!(
            cursor_project_hook_file("cursor-agent", &[clean.path(), planted.path()]),
            Some(planted.path().join(".cursor/hooks.json"))
        );
    }
}
