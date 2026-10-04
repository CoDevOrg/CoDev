#[cfg(target_os = "linux")]
use std::{
    env,
    io::{Read, Write},
    net::{SocketAddr, TcpListener},
    sync::Arc,
};

#[cfg(target_os = "linux")]
use codev_runtime::guest::GuestService;
use codev_runtime::model::{Result, RuntimeError};

#[cfg(target_os = "linux")]
const GUEST_PORT: u32 = 52;
#[cfg(target_os = "linux")]
const MAX_HEADERS_BYTES: usize = 64 << 10;
#[cfg(target_os = "linux")]
const MAX_BODY_BYTES: usize = 2 << 20;

#[cfg(target_os = "linux")]
fn main() -> Result<()> {
    use std::time::Duration;
    use tracing::{error, info};
    use tracing_subscriber::EnvFilter;
    use vsock::{VsockAddr, VsockListener};

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();
    let workspace = env::var("CODEV_WORKSPACE_ROOT").unwrap_or_else(|_| "/workspace".into());
    let service = Arc::new(GuestService::new(&workspace)?);
    if let Ok(address) = env::var("CODEV_GUESTD_LISTEN_ADDR") {
        let address = parse_loopback_address(&address)?;
        let listener = TcpListener::bind(address).map_err(RuntimeError::internal)?;
        info!(%workspace, %address, "guest daemon listening on loopback TCP");
        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    stream.set_read_timeout(Some(Duration::from_secs(70))).ok();
                    stream.set_write_timeout(Some(Duration::from_secs(70))).ok();
                    spawn_connection(stream, service.clone());
                }
                Err(error) => error!(%error, "failed to accept guest connection"),
            }
        }
        return Ok(());
    }

    let listener = VsockListener::bind(&VsockAddr::new(libc::VMADDR_CID_ANY, GUEST_PORT))
        .map_err(RuntimeError::internal)?;
    info!(%workspace, port = GUEST_PORT, "guest daemon listening");
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                stream.set_read_timeout(Some(Duration::from_secs(70))).ok();
                stream.set_write_timeout(Some(Duration::from_secs(70))).ok();
                spawn_connection(stream, service.clone());
            }
            Err(error) => error!(%error, "failed to accept guest connection"),
        }
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn parse_loopback_address(address: &str) -> Result<SocketAddr> {
    let address = address
        .parse::<SocketAddr>()
        .map_err(|_| RuntimeError::BadRequest("invalid guest daemon listen address".into()))?;
    if !address.ip().is_loopback() {
        return Err(RuntimeError::BadRequest(
            "guest daemon TCP listener must use a loopback address".into(),
        ));
    }
    Ok(address)
}

#[cfg(target_os = "linux")]
fn spawn_connection<S>(mut stream: S, service: Arc<GuestService>)
where
    S: ReadWrite + Send + 'static,
{
    use std::thread;
    use tracing::error;

    thread::spawn(move || {
        if let Err(error) = serve_connection(&mut stream, &service) {
            error!(%error, "guest request failed");
        }
    });
}

#[cfg(not(target_os = "linux"))]
fn main() -> Result<()> {
    Err(RuntimeError::Unavailable(
        "the guest daemon requires Linux vsock".into(),
    ))
}

#[cfg(target_os = "linux")]
fn serve_connection(stream: &mut impl ReadWrite, service: &GuestService) -> Result<()> {
    let mut request = Vec::new();
    let headers_end = loop {
        if request.len() >= MAX_HEADERS_BYTES {
            return Err(RuntimeError::BadRequest(
                "HTTP headers exceed 64 KiB".into(),
            ));
        }
        let mut byte = [0_u8; 1];
        stream
            .read_exact(&mut byte)
            .map_err(RuntimeError::internal)?;
        request.push(byte[0]);
        if request.ends_with(b"\r\n\r\n") {
            break request.len();
        }
    };
    let headers = std::str::from_utf8(&request[..headers_end])
        .map_err(|_| RuntimeError::BadRequest("HTTP headers are not UTF-8".into()))?;
    let request_line = headers
        .lines()
        .next()
        .ok_or_else(|| RuntimeError::BadRequest("missing HTTP request line".into()))?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| RuntimeError::BadRequest("missing HTTP method".into()))?;
    let path = request_parts
        .next()
        .ok_or_else(|| RuntimeError::BadRequest("missing HTTP path".into()))?;
    let content_length = headers
        .lines()
        .skip(1)
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })
        .unwrap_or(0);
    if content_length > MAX_BODY_BYTES {
        return Err(RuntimeError::BadRequest(
            "request body exceeds two MiB".into(),
        ));
    }
    let mut body = vec![0_u8; content_length];
    stream
        .read_exact(&mut body)
        .map_err(RuntimeError::internal)?;
    let response = service.handle(method, path, &body);
    let reason = match response.status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        408 => "Request Timeout",
        409 => "Conflict",
        413 => "Payload Too Large",
        503 => "Service Unavailable",
        _ => "Internal Server Error",
    };
    write!(
        stream,
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        response.status,
        reason,
        response.body.len()
    )
    .map_err(RuntimeError::internal)?;
    stream
        .write_all(&response.body)
        .map_err(RuntimeError::internal)?;
    stream.flush().map_err(RuntimeError::internal)
}

#[cfg(target_os = "linux")]
trait ReadWrite: Read + Write {}
#[cfg(target_os = "linux")]
impl<T: Read + Write> ReadWrite for T {}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::parse_loopback_address;
    use codev_runtime::model::RuntimeError;

    #[test]
    fn accepts_loopback_and_ephemeral_ports() {
        assert_eq!(
            parse_loopback_address("127.0.0.1:5252").unwrap(),
            "127.0.0.1:5252".parse().unwrap()
        );
        assert_eq!(
            parse_loopback_address("[::1]:0").unwrap(),
            "[::1]:0".parse().unwrap()
        );
    }

    #[test]
    fn rejects_non_loopback_and_malformed_addresses() {
        assert!(matches!(
            parse_loopback_address("0.0.0.0:5252"),
            Err(RuntimeError::BadRequest(_))
        ));
        assert!(matches!(
            parse_loopback_address("localhost:5252"),
            Err(RuntimeError::BadRequest(_))
        ));
    }
}
