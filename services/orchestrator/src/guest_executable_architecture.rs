use std::{fs::File, io::Read, path::Path};

use crate::guest_spawn_error::guest_spawn_error;

/// Check ELF headers before portable-pty can hide ENOEXEC with its shell fallback.
pub(crate) fn guest_executable_architecture_error(
    program: &str,
    working_directory: &Path,
    search_path: &str,
) -> Option<String> {
    let path = if program.contains('/') {
        working_directory.join(program)
    } else {
        search_path
            .split(':')
            .map(|directory| Path::new(directory).join(program))
            .find(|path| path.is_file())?
    };
    let mut header = [0u8; 20];
    File::open(path).ok()?.read_exact(&mut header).ok()?;
    if &header[..4] != b"\x7fELF" {
        return None;
    }
    let machine = match header[5] {
        1 => u16::from_le_bytes([header[18], header[19]]),
        2 => u16::from_be_bytes([header[18], header[19]]),
        _ => return None,
    };
    let expected = match std::env::consts::ARCH {
        "aarch64" => 183,
        "x86_64" => 62,
        _ => return None,
    };
    (machine != expected).then(|| guest_spawn_error(program, &std::io::Error::from_raw_os_error(8)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_foreign_elf_but_allows_native_elf_and_scripts() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("fixture");
        let native: u16 = if std::env::consts::ARCH == "aarch64" {
            183
        } else {
            62
        };
        let foreign: u16 = if native == 183 { 62 } else { 183 };
        let mut header = [0u8; 20];
        header[..4].copy_from_slice(b"\x7fELF");
        header[5] = 1;
        header[18..20].copy_from_slice(&foreign.to_le_bytes());
        std::fs::write(&path, header).unwrap();
        assert!(
            guest_executable_architecture_error("./fixture", directory.path(), "")
                .unwrap()
                .contains("Unsupported executable architecture")
        );
        header[18..20].copy_from_slice(&native.to_le_bytes());
        std::fs::write(&path, header).unwrap();
        assert!(
            guest_executable_architecture_error(
                "fixture",
                directory.path(),
                directory.path().to_str().unwrap()
            )
            .is_none()
        );
        std::fs::write(path, b"#!/bin/sh\nprintf 'script'\n").unwrap();
        assert!(guest_executable_architecture_error("./fixture", directory.path(), "").is_none());
    }
}
