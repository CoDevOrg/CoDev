import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { normalizePostgresConnectionString } from "../../packages/db/src/connection.ts";
import { armOwnerCostReports } from "./arm-owner-cost-reports.mjs";

const require = createRequire(
  new URL("../../packages/db/package.json", import.meta.url),
);
const { Pool } = require("pg");
const required = (key) => {
  if (process.env[key] === undefined || process.env[key] === "")
    throw new Error(`Missing ${key}`);
  return process.env[key];
};
const subscription = required("AZURE_SUBSCRIPTION_ID");
const group = required("ARM_WORKSPACE_RESOURCE_GROUP");
if (!/^codev-arm-workspace-[a-z0-9-]+$/.test(group))
  throw new Error("Invalid ARM resource group.");
const url = new URL(required("ARM_WORKSPACE_COST_REPORT_URL"));
if (url.protocol !== "https:" || url.pathname !== "/api/gen2/compute/reconcile")
  throw new Error("Invalid cost ingestion endpoint.");
const secret = required("CRON_SECRET");
const tax = Number(required("ARM_WORKSPACE_COST_TAX_RATE"));
const now = new Date();
const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const pool = new Pool({
  connectionString: normalizePostgresConnectionString(required("POSTGRES_URL")),
  connectionTimeoutMillis: 10000,
});
try {
  const { rows } = await pool.query(
    `SELECT id AS workspace_id, owner_id FROM gen2_workspaces WHERE runtime_provider = 'azure_arm'
    UNION SELECT workspace_id, owner_id FROM gen2_compute_sessions WHERE started_at >= $1 OR ended_at IS NULL OR ended_at >= $1
    UNION SELECT NULL AS workspace_id, id AS owner_id FROM users`,
    [month],
  );
  const pages = queryCosts(subscription, group);
  const reports = armOwnerCostReports(rows, pages, now, tax);
  for (const report of reports) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Cost ingestion HTTP ${response.status}`);
    await response.text();
  }
  console.log(
    `Published ${reports.length} complete USD owner cost reports from ${pages.length} Azure page(s).`,
  );
} finally {
  await pool.end();
}

function queryCosts(subscriptionId, resourceGroup) {
  let endpoint = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.CostManagement/query?api-version=2025-03-01`;
  const body = JSON.stringify({
    type: "ActualCost",
    timeframe: "MonthToDate",
    dataset: {
      granularity: "None",
      aggregation: { totalCost: { name: "PreTaxCost", function: "Sum" } },
      grouping: [
        { type: "Dimension", name: "ResourceId" },
        { type: "Dimension", name: "ServiceName" },
      ],
    },
  });
  const pages = [];
  while (endpoint) {
    if (!endpoint.startsWith("https://management.azure.com/"))
      throw new Error("Invalid cost pagination URL.");
    if (pages.length >= 100) throw new Error("Cost pagination limit exceeded.");
    const page = JSON.parse(
      execFileSync(
        "az",
        [
          "rest",
          "--method",
          "post",
          "--url",
          endpoint,
          "--body",
          body,
          "-o",
          "json",
        ],
        {
          encoding: "utf8",
          timeout: 60000,
          stdio: ["ignore", "pipe", "inherit"],
        },
      ),
    );
    pages.push(page);
    endpoint = page.properties?.nextLink;
  }
  return pages;
}
