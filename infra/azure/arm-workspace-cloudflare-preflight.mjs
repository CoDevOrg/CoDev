import { ArmWorkspaceTunnel } from "./arm-workspace-tunnel.mjs";

const accountId = "84a1d01866de04e04320feddfb199b83";
const zoneId = "c474dbc7af01ea073573a250fbd1d5ec";
const token = process.env.CLOUDFLARE_API_TOKEN;
const runId = process.env.GITHUB_RUN_ID;
if (!token || !/^[0-9]+$/.test(runId ?? ""))
  throw new Error("Cloudflare canary configuration required");
const tunnel = new ArmWorkspaceTunnel({
  accountId,
  zoneId,
  zoneName: "trycodev.com",
  apiToken: token,
  signingKeyPath: "/tmp/unused",
  guest: null,
});
const name = `codev-permission-${runId}`;
const host = `${name}.trycodev.com`;
const created = await tunnel.request(
  `/accounts/${accountId}/cfd_tunnel`,
  "POST",
  { name, config_src: "cloudflare" },
);
let record;
try {
  await tunnel.request(
    `/accounts/${accountId}/cfd_tunnel/${created.id}/configurations`,
    "PUT",
    { config: { ingress: [{ service: "http_status:404" }] } },
  );
  record = await tunnel.request(`/zones/${zoneId}/dns_records`, "POST", {
    type: "CNAME",
    name: host,
    content: `${created.id}.cfargotunnel.com`,
    proxied: true,
    ttl: 1,
  });
  await tunnel.request(`/accounts/${accountId}/cfd_tunnel/${created.id}/token`);
  console.log("Cloudflare tunnel and DNS automation permissions verified");
} finally {
  const cleanups = [
    ...(record
      ? [tunnel.request(`/zones/${zoneId}/dns_records/${record.id}`, "DELETE")]
      : []),
    tunnel.request(`/accounts/${accountId}/cfd_tunnel/${created.id}`, "DELETE"),
  ];
  const results = await Promise.allSettled(cleanups);
  if (results.some((result) => result.status === "rejected"))
    throw new Error("CLOUDFLARE_PREFLIGHT_CLEANUP_FAILED");
}
