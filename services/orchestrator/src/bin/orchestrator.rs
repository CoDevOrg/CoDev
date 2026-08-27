use std::{env, sync::Arc, time::Duration};

use codev_runtime::{
    backend::{Backend, IdeBackend, SharedBackend},
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

    let ide = configure_ide_backend();

    if !host_idle_timeout.is_zero() {
        tokio::spawn(stop_idle_host(
            backend.clone(),
            ide.clone(),
            host_idle_timeout,
        ));
    }

    let port = env::var("PORT").unwrap_or_else(|_| "8080".into());
    let listener = TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .map_err(RuntimeError::internal)?;
    info!(port, "orchestrator listening");
    axum::serve(listener, http_api::router(backend, ide))
        .with_graceful_shutdown(shutdown_signal())
        .await
        .map_err(RuntimeError::internal)
}

/// The Orca IDE backend is optional: a host that has not been provisioned
/// with `CODEV_ORCA_PUBLIC_HOST` yet (or a non-Linux dev build) simply serves
/// every other route and reports the IDE routes as unavailable, rather than
/// failing to start.
fn configure_ide_backend() -> IdeBackend {
    #[cfg(target_os = "linux")]
    {
        use codev_runtime::backend::{OrcaBackend, OrcaConfig};
        match OrcaConfig::from_environment() {
            Ok(config) => IdeBackend::Orca(OrcaBackend::new(config)),
            Err(error) => {
                tracing::warn!(
                    %error,
                    "Orca IDE backend not configured; /ide routes will be unavailable"
                );
                IdeBackend::Disabled
            }
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        IdeBackend::Disabled
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

/// Power the EC2 host off once nothing has been used on it for `idle_timeout`.
///
/// Two things have to be true for this to behave the way somebody using CoDev
/// expects. A live sandbox blocks shutdown outright — it holds VM state, and
/// its own reaper is what eventually hibernates it. IDE sessions, by
/// contrast, are measured by *when they were last used*, not by whether they
/// still exist: a workspace opened straight into its Orca IDE never
/// provisions a sandbox, so ignoring IDE sessions would power the host off
/// mid-session, while merely counting them would restart this clock from zero
/// the moment the IDE reaper removed an abandoned one — billing a second full
/// idle window for a host nobody had touched in twice that long.
async fn stop_idle_host(backend: SharedBackend, ide: IdeBackend, idle_timeout: Duration) {
    let mut interval = time::interval(Duration::from_secs(30));
    interval.tick().await;
    let mut quiet_since: Option<chrono::DateTime<chrono::Utc>> = None;
    loop {
        interval.tick().await;
        if backend.active_count().await > 0 {
            quiet_since = None;
            continue;
        }
        let since = *quiet_since.get_or_insert_with(chrono::Utc::now);
        // Whichever is later: when this loop first saw the host quiet, or
        // when an IDE session was last actually used.
        let idle_from = ide
            .last_activity_at()
            .await
            .map_or(since, |last| last.max(since));
        if (chrono::Utc::now() - idle_from)
            .to_std()
            .is_ok_and(|idle| idle < idle_timeout)
        {
            continue;
        }
        info!(?idle_timeout, "stopping idle Firecracker host");
        match time::timeout(
            Duration::from_secs(30),
            Command::new("systemctl").arg("poweroff").output(),
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
        && !(Duration::from_secs(5 * 60)..=Duration::from_secs(4 * 60 * 60)).contains(&duration)
    {
        return Err(RuntimeError::BadRequest(
            "CODEV_HOST_IDLE_TIMEOUT must be between five minutes and four hours".into(),
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
