use std::{env, sync::Arc, time::Duration};

use codev_runtime::{
    backend::{Backend, SharedBackend},
    http_api,
    model::{Result, RuntimeError},
};
use tokio::{net::TcpListener, process::Command, signal, time};
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .json()
        .with_current_span(false)
        .with_span_list(false)
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let backend = configure_backend().await?;
    let backend = Arc::new(backend);
    let host_idle_timeout = environment_duration("CODEV_HOST_IDLE_TIMEOUT", Duration::ZERO)?;

    tokio::spawn(reap_expired_sandboxes(backend.clone()));

    if !host_idle_timeout.is_zero() {
        tokio::spawn(stop_idle_host(backend.clone(), host_idle_timeout));
    }

    let port = env::var("PORT").unwrap_or_else(|_| "8080".into());
    let listener = TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .map_err(RuntimeError::internal)?;
    info!(port, "orchestrator listening");
    axum::serve(listener, http_api::router(backend))
        .with_graceful_shutdown(shutdown_signal())
        .await
        .map_err(RuntimeError::internal)
}

async fn reap_expired_sandboxes(backend: SharedBackend) {
    let mut interval = time::interval(Duration::from_secs(30));
    interval.tick().await;
    loop {
        interval.tick().await;
        let reaped = backend.reap_expired().await;
        if reaped > 0 {
            info!(reaped, "stopped or hibernated idle Firecracker sandboxes");
        }
    }
}

async fn configure_backend() -> Result<Backend> {
    match env::var("SANDBOX_BACKEND")
        .unwrap_or_else(|_| "fake".into())
        .as_str()
    {
        "fake" => Ok(Backend::fake()),
        "firecracker" => {
            #[cfg(target_os = "linux")]
            {
                use codev_runtime::backend::{FirecrackerBackend, FirecrackerConfig};
                let config = FirecrackerConfig::from_environment()?;
                let backend = FirecrackerBackend::new(config).await?;
                Ok(Backend::Firecracker(backend))
            }
            #[cfg(not(target_os = "linux"))]
            {
                Err(RuntimeError::Unavailable(
                    "the Firecracker backend requires Linux".into(),
                ))
            }
        }
        _ => Err(RuntimeError::BadRequest(
            "SANDBOX_BACKEND must be fake or firecracker".into(),
        )),
    }
}

/// Power the runtime host off once nothing has been used on it for
/// `idle_timeout`.
///
/// Live sandboxes block shutdown. Their reaper hibernates expired guests
/// before this timer can deallocate the runtime host.
async fn stop_idle_host(backend: SharedBackend, idle_timeout: Duration) {
    let mut interval = time::interval(Duration::from_secs(30));
    interval.tick().await;
    let mut quiet_since: Option<chrono::DateTime<chrono::Utc>> = None;
    loop {
        interval.tick().await;
        // The boot-time service deliberately keeps /healthz unavailable until
        // it has fetched and installed this release. Treat that preparation as
        // host activity: otherwise the one-minute idle timer can deallocate a
        // freshly woken VM before the control plane is allowed to create its
        // first sandbox, which causes an endless start/stop loop.
        if http_api::host_bootstrap_still_running().await {
            quiet_since = None;
            continue;
        }
        if backend.active_count().await > 0 {
            quiet_since = None;
            continue;
        }
        let since = *quiet_since.get_or_insert_with(chrono::Utc::now);
        if (chrono::Utc::now() - since)
            .to_std()
            .is_ok_and(|idle| idle < idle_timeout)
        {
            continue;
        }
        // This is the final, atomic check. A sandbox create holds the same
        // lifecycle lock while it prepares the guest, so a VM cannot be
        // deallocated between the idle observation above and guest readiness.
        if !backend.begin_host_shutdown_if_idle().await {
            quiet_since = None;
            continue;
        }
        info!(?idle_timeout, "stopping idle Firecracker host");
        // Not `systemctl poweroff` directly. The helper asks Azure Resource
        // Manager to deallocate the VM; a guest-initiated poweroff leaves it
        // allocated and still charging for its cores. See codev-host-poweroff
        // in infra/runtime/scripts/bootstrap-host.sh.
        match time::timeout(
            Duration::from_secs(30),
            Command::new("/usr/local/sbin/codev-host-poweroff").output(),
        )
        .await
        {
            Ok(Ok(output)) if output.status.success() => return,
            Ok(Ok(output)) => error!(
                status = %output.status,
                stderr = %String::from_utf8_lossy(&output.stderr),
                "failed to stop idle host"
            ),
            Ok(Err(error)) => error!(%error, "failed to execute host shutdown"),
            Err(_) => error!("host shutdown command timed out"),
        }
        backend.cancel_host_shutdown();
        // The poweroff failed. Back off a full window before trying again
        // rather than retrying every 30 seconds.
        quiet_since = Some(chrono::Utc::now());
    }
}

fn environment_duration(name: &str, default: Duration) -> Result<Duration> {
    let Ok(value) = env::var(name) else {
        return Ok(default);
    };
    if value == "0" {
        return Ok(Duration::ZERO);
    }
    let (number, multiplier) = if let Some(value) = value.strip_suffix('s') {
        (value, 1)
    } else if let Some(value) = value.strip_suffix('m') {
        (value, 60)
    } else if let Some(value) = value.strip_suffix('h') {
        (value, 60 * 60)
    } else {
        return Err(RuntimeError::BadRequest(format!(
            "{name} must use an s, m, or h suffix"
        )));
    };
    let seconds = number
        .parse::<u64>()
        .map_err(|_| RuntimeError::BadRequest(format!("{name} is invalid")))?
        .checked_mul(multiplier)
        .ok_or_else(|| RuntimeError::BadRequest(format!("{name} is too large")))?;
    let duration = Duration::from_secs(seconds);
    if name == "CODEV_HOST_IDLE_TIMEOUT"
        && !(Duration::from_secs(60)..=Duration::from_secs(4 * 60 * 60)).contains(&duration)
    {
        return Err(RuntimeError::BadRequest(
            "CODEV_HOST_IDLE_TIMEOUT must be between one minute and four hours".into(),
        ));
    }
    Ok(duration)
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c().await.expect("install Ctrl-C handler");
    };
    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
}
