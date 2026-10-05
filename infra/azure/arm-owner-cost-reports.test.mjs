import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { armOwnerCostReports } from "./arm-owner-cost-reports.mjs";
const workspace = "workspace-1";
const resource = `/subscriptions/s/disks/codev-ws-${createHash("sha256").update(workspace).digest("hex").slice(0, 16)}-data`;
const now = new Date("2026-10-05T12:00:00Z");
const page = (rows) => ({
  properties: {
    columns: ["PreTaxCost", "ResourceId", "ServiceName", "Currency"].map(
      (name) => ({ name }),
    ),
    rows,
  },
});

test("includes disk transactions, other meters, and verified tax for every historical owner", () => {
  const owners = [
    { workspace_id: workspace, owner_id: "old" },
    { workspace_id: workspace, owner_id: "new" },
  ];
  const reports = armOwnerCostReports(
    owners,
    [
      page([
        [1.01, resource, "Storage", "USD"],
        [0.1, resource, "Virtual Machines", "USD"],
        [0.01, resource, "Bandwidth", "USD"],
      ]),
    ],
    now,
    0.05,
  );
  assert.equal(reports.length, 2);
  for (const r of reports) {
    assert.equal(r.storageCents, 101);
    assert.equal(r.computeCents, 10);
    assert.equal(r.networkCents, 1);
    assert.equal(r.otherCents, 6);
    assert.equal(r.month, "2026-10-01T00:00:00.000Z");
  }
});
test("unknown charged resources block owners and credits never erase charges", () => {
  const reports = armOwnerCostReports(
    [{ workspace_id: workspace, owner_id: "owner" }],
    [
      page([
        [1, "/unknown", "Storage", "USD"],
        [-100, resource, "Storage", "USD"],
      ]),
    ],
    now,
    0,
  );
  assert.equal(reports[0].blocked, true);
  assert.equal(reports[0].storageCents, 0);
});
test("refuses foreign currencies and unknown tax rather than fabricating complete reports", () => {
  const owners = [{ workspace_id: workspace, owner_id: "owner" }];
  assert.throws(
    () =>
      armOwnerCostReports(
        owners,
        [page([[1, resource, "Storage", "CAD"]])],
        now,
        0,
      ),
    /USD/,
  );
  assert.throws(() => armOwnerCostReports(owners, [], now, NaN), /tax rate/);
});
test("initializes owners without resources and validates every response page", () => {
  assert.equal(
    armOwnerCostReports(
      [{ workspace_id: null, owner_id: "owner" }],
      [page([])],
      now,
      0,
    )[0].storageCents,
    0,
  );
  assert.throws(() => armOwnerCostReports([], [{}], now, 0), /Invalid Azure/);
});
