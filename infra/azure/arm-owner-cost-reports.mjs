import { createHash } from "node:crypto";

/** Conservatively charge shared historical resources to each recorded owner. */
export function armOwnerCostReports(ownership, pages, now, taxRate) {
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 1)
    throw new Error("An explicit verified Azure tax rate (0..1) is required.");
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const owners = new Map();
  const resources = new Map();
  for (const { workspace_id, owner_id } of ownership) {
    if (!owners.has(owner_id))
      owners.set(owner_id, emptyReport(owner_id, month, now));
    if (!workspace_id) continue;
    const hash = createHash("sha256")
      .update(workspace_id)
      .digest("hex")
      .slice(0, 16);
    const set = resources.get(hash) ?? new Set();
    set.add(owner_id);
    resources.set(hash, set);
  }
  for (const page of pages) applyPage(page, owners, resources);
  return [...owners.values()].map((report) => {
    const total =
      report.computeCents +
      report.storageCents +
      report.networkCents +
      report.operationsCents +
      report.otherCents;
    return {
      ...report,
      otherCents: report.otherCents + Math.ceil(total * taxRate),
    };
  });
}

function emptyReport(ownerId, month, now) {
  return {
    currency: "USD",
    complete: true,
    ownerId,
    month: month.toISOString(),
    observedAt: now.toISOString(),
    computeCents: 0,
    storageCents: 0,
    networkCents: 0,
    operationsCents: 0,
    otherCents: 0,
    blocked: false,
  };
}

function applyPage(page, owners, resources) {
  const columns = page.properties?.columns?.map((column) => column.name);
  if (!columns || !Array.isArray(page.properties.rows))
    throw new Error("Invalid Azure cost response.");
  const index = (name) => {
    const value = columns.indexOf(name);
    if (value < 0) throw new Error(`Missing Azure cost column ${name}.`);
    return value;
  };
  const cost = index("PreTaxCost"),
    resource = index("ResourceId"),
    service = index("ServiceName"),
    currency = index("Currency");
  for (const row of page.properties.rows) {
    if (row[currency] !== "USD" || !Number.isFinite(Number(row[cost])))
      throw new Error("Azure costs must be finite USD values.");
    const cents = Math.ceil(Math.max(0, Number(row[cost])) * 100);
    if (!cents) continue; // Credits never hide positive charges.
    const hash = String(row[resource]).match(
      /\/codev-ws-([a-f0-9]{16})(?:-|$)/i,
    )?.[1];
    const attributed = hash && resources.get(hash);
    if (!attributed?.size) {
      for (const owner of owners.values()) owner.blocked = true;
      continue; // Unattributed runtime charges must not silently vanish.
    }
    const field = category(String(row[service]));
    for (const ownerId of attributed) owners.get(ownerId)[field] += cents;
  }
}

function category(service) {
  if (/virtual machine/i.test(service)) return "computeCents";
  if (/storage|disk|snapshot/i.test(service)) return "storageCents";
  if (/network|bandwidth|ip address/i.test(service)) return "networkCents";
  return "otherCents";
}
