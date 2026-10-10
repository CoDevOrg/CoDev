/**
 * Reads `cat /proc/net/tcp /proc/net/tcp6` output from the guest. Only the
 * guest preview proxy decides what it forwards; these rules mirror its own
 * (docs/WEB_HOSTING.md) so the Browser tab offers ports it will accept.
 */

/** The preview proxy's socket, held by systemd (uid 0) from early boot. */
const PROXY_PORT = 5261;
/** Guest services and cloudflared's metrics range are never previewed. */
const RESERVED = new Set([9, 4879, 5252, 5260, PROXY_PORT]);
const RESERVED_RANGE = [20_241, 20_245] as const;
/** Terminals run as codev-shell (2000); agent users are higher. */
const MEMBER_UID = 2_000;

type ListeningSocket = {
  address: "127.0.0.1" | "0.0.0.0" | "::1" | "::" | "other";
  port: number;
  uid: number;
};

const ROW =
  /^\s*\d+:\s+([0-9A-Fa-f]{8}|[0-9A-Fa-f]{32}):([0-9A-Fa-f]{4})\s+\S+\s+([0-9A-Fa-f]{2})\s+\S+\s+\S+\s+\S+\s+(\d+)\s/;

/** Kernel addresses are 32-bit words in host (little-endian) byte order. */
function addressOf(hex: string): ListeningSocket["address"] {
  const bytes = (hex.match(/.{8}/g) ?? []).flatMap((word) =>
    (word.match(/../g) ?? []).reverse().map((byte) => parseInt(byte, 16)),
  );
  if (bytes.length === 4) {
    const text = bytes.join(".");
    return text === "127.0.0.1" || text === "0.0.0.0" ? text : "other";
  }
  if (bytes.slice(0, 15).some(Boolean)) return "other";
  return bytes[15] === 0 ? "::" : bytes[15] === 1 ? "::1" : "other";
}

function listeningSockets(output: string): ListeningSocket[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = ROW.exec(`${line} `);
    if (!match || match[3]!.toUpperCase() !== "0A") return [];
    return [
      {
        address: addressOf(match[1]!),
        port: parseInt(match[2]!, 16),
        uid: Number(match[4]),
      },
    ];
  });
}

function reserved(port: number) {
  return (
    RESERVED.has(port) ||
    (port >= RESERVED_RANGE[0] && port <= RESERVED_RANGE[1])
  );
}

/**
 * Whether this guest runs the preview proxy, and the dev servers it can
 * reach: ports whose every listener belongs to a member process, bound to
 * an address the proxy connects to (127.0.0.1 or ::1, directly or through
 * a wildcard bind).
 */
export function readGen2PreviewPorts(output: string) {
  const sockets = listeningSockets(output);
  const proxySockets = sockets.filter(({ port }) => port === PROXY_PORT);
  const proxy =
    proxySockets.some(({ address, uid }) => address === "127.0.0.1" && !uid) &&
    proxySockets.every(({ uid }) => uid === 0);
  const byPort = new Map<number, ListeningSocket[]>();
  sockets.forEach((row) =>
    byPort.set(row.port, [...(byPort.get(row.port) ?? []), row]),
  );
  const ports = [...byPort]
    .filter(
      ([port, rows]) =>
        !reserved(port) &&
        rows.every(({ uid }) => uid >= MEMBER_UID) &&
        rows.some(({ address }) => address !== "other"),
    )
    .map(([port, rows]) => ({
      port,
      address: rows.some(
        ({ address }) => address === "0.0.0.0" || address === "::",
      )
        ? ("any" as const)
        : ("loopback" as const),
    }))
    .sort((left, right) => left.port - right.port)
    .slice(0, 20);
  return { proxy, ports };
}
