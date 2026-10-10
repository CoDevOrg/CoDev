import { describe, expect, it } from "vitest";

import {
  isGen2PreviewReservedPort,
  readGen2PreviewPorts,
} from "./workspace-ports-parse";

const header =
  "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode";
const header6 =
  "  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode";
const row = (index: number, local: string, state: string, uid: number) =>
  `   ${index}: ${local} 00000000:0000 ${state} 00000000:00000000 00:00000000 00000000 ${String(uid).padStart(5)}        0 1${index}23 1 0000000000000000 100 0 0 10 0`;
const row6 = (index: number, local: string, state: string, uid: number) =>
  `   ${index}: ${local} 00000000000000000000000000000000:0000 ${state} 00000000:00000000 00:00000000 00000000 ${String(uid).padStart(5)}        0 2${index}45 1 0000000000000000 100 0 0 10 0`;

const LOOPBACK6 = "00000000000000000000000001000000";
const ANY6 = "00000000000000000000000000000000";

/** PTY output of `cat /proc/net/tcp /proc/net/tcp6`, with CRLF endings. */
const sample = [
  header,
  row(0, "0100007F:148D", "0A", 0), // 127.0.0.1:5261 preview proxy socket
  row(1, "0100007F:1484", "0A", 0), // 127.0.0.1:5252 guestd
  row(2, "00000000:0BB8", "0A", 2000), // 0.0.0.0:3000 terminal dev server
  row(3, "0100007F:1F90", "0A", 0), // 127.0.0.1:8080 root
  row(4, "0100007F:4F11", "0A", 2000), // 127.0.0.1:20241 reserved range
  row(5, "0100007F:0BB8", "01", 2000), // established, not a listener
  row(6, "0400000A:240D", "0A", 2000), // 10.0.0.4:9229, unreachable address
  header6,
  row6(0, `${LOOPBACK6}:1435`, "0A", 100001), // [::1]:5173 agent session
  row6(1, `${ANY6}:1F90`, "0A", 2000), // [::]:8080 shares a port with root
  row6(2, `${ANY6}:130F`, "0A", 0), // [::]:4879 Superset host
  "",
].join("\r\n");

describe("guest listening sockets", () => {
  it("finds the proxy and the member dev servers it may reach", () => {
    expect(readGen2PreviewPorts(sample)).toEqual({
      proxy: true,
      ports: [
        { port: 3000, address: "any" },
        { port: 5173, address: "loopback" },
      ],
    });
  });

  it("refuses a proxy port a member process squats on", () => {
    const squatted = [header, row(0, "0100007F:148D", "0A", 2000)].join("\n");
    expect(readGen2PreviewPorts(squatted).proxy).toBe(false);
    const shared = [
      header,
      row(0, "0100007F:148D", "0A", 0),
      header6,
      row6(0, `${LOOPBACK6}:148D`, "0A", 2000),
    ].join("\n");
    expect(readGen2PreviewPorts(shared)).toEqual({ proxy: false, ports: [] });
  });

  it("reads nothing from a legacy guest or unexpected output", () => {
    expect(readGen2PreviewPorts("")).toEqual({ proxy: false, ports: [] });
    expect(
      readGen2PreviewPorts("cat: /proc/net/tcp6: No such file\r\n"),
    ).toEqual({ proxy: false, ports: [] });
  });

  it("reserves guest service ports whether or not they listen", () => {
    [9, 4879, 5252, 5260, 5261, 20241, 20245].forEach((port) =>
      expect(isGen2PreviewReservedPort(port)).toBe(true),
    );
    [3000, 5173, 20240, 20246].forEach((port) =>
      expect(isGen2PreviewReservedPort(port)).toBe(false),
    );
  });

  it("caps the list and keeps ports in order", () => {
    const many = [
      header,
      ...Array.from({ length: 30 }, (_, index) =>
        row(
          index,
          `0100007F:${(4000 + 30 - index).toString(16).toUpperCase().padStart(4, "0")}`,
          "0A",
          2000,
        ),
      ),
    ].join("\n");
    const { ports } = readGen2PreviewPorts(many);
    expect(ports).toHaveLength(20);
    expect(ports[0]).toEqual({ port: 4001, address: "loopback" });
    expect(ports.at(-1)?.port).toBe(4020);
  });
});
