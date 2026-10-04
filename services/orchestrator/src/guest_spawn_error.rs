use std::error::Error;

pub(crate) fn guest_spawn_error(program: &str, error: &(dyn Error + 'static)) -> String {
    let detail = error.to_string();
    if std::iter::successors(Some(error), |cause| (*cause).source())
        .any(|cause| cause.to_string().contains("Exec format error"))
    {
        return format!(
            "Unsupported executable architecture: {program} cannot run on Linux {}. Use a matching build or rebuild the dependency from source.",
            std::env::consts::ARCH
        );
    }
    format!("Unable to spawn {program}: {detail}")
}

#[cfg(test)]
mod tests {
    use super::guest_spawn_error;

    #[test]
    fn explains_an_incompatible_binary_without_a_connection_error() {
        let message = guest_spawn_error("x86-only", &std::io::Error::from_raw_os_error(8));
        assert!(message.contains("Unsupported executable architecture"));
        assert!(message.contains(std::env::consts::ARCH));
        assert!(message.contains("rebuild"));
    }

    #[test]
    fn preserves_other_spawn_errors() {
        assert_eq!(
            guest_spawn_error(
                "missing",
                &std::io::Error::new(std::io::ErrorKind::NotFound, "No such file or directory")
            ),
            "Unable to spawn missing: No such file or directory"
        );
    }
}
