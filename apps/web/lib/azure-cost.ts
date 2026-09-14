import "server-only";

import { unstable_cache } from "next/cache";
import { z } from "zod";

import {
  getAzureCredential,
  getAzureResourceGroup,
  getAzureSubscriptionId,
} from "./azure";

const COST_MANAGEMENT_API_VERSION = "2025-03-01";
const COST_QUERY_MAX_ATTEMPTS = 3;

/** The date from which CoDev runtime cost attribution is tracked. */
export const COST_TRACKING_START_DATE = "2026-09-05";

const AzureCostQueryResponseSchema = z.object({
  properties: z
    .object({
      columns: z.array(z.object({ name: z.string() })),
      rows: z.array(z.array(z.union([z.number(), z.string(), z.null()]))),
    })
    .optional(),
});

export interface CodevAzureSpend {
  /** Real Azure charges for the configured CoDev resource group. */
  totalCost: number;
  /** Azure VM compute charges, which can be allocated by workspace runtime. */
  computeCost: number;
  /** Shared Azure services that cannot be honestly split per workspace. */
  overheadCost: number;
  currency: string;
  startDate: string;
  endDate: string;
}

function isAzureComputeService(serviceName: string) {
  return /virtual machine/i.test(serviceName);
}

function emptySpend(endDate: string): CodevAzureSpend {
  return {
    totalCost: 0,
    computeCost: 0,
    overheadCost: 0,
    currency: "USD",
    startDate: COST_TRACKING_START_DATE,
    endDate,
  };
}

function tomorrowIsoDate() {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() + 1);
  return end.toISOString().slice(0, 10);
}

async function queryCostManagement(url: string, init: RequestInit) {
  for (let attempt = 1; attempt <= COST_QUERY_MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url, init);
    if (response.status !== 429 || attempt === COST_QUERY_MAX_ATTEMPTS) {
      return response;
    }

    const retryAfterSeconds = Number(response.headers?.get("retry-after"));
    const retryDelayMs = Number.isFinite(retryAfterSeconds)
      ? Math.min(5_000, Math.max(250, retryAfterSeconds * 1_000))
      : 1_000 * attempt;
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }

  throw new Error("Azure Cost Management query retry limit was exceeded.");
}

async function fetchCodevAzureSpend(): Promise<CodevAzureSpend> {
  const endDate = tomorrowIsoDate();
  if (endDate <= COST_TRACKING_START_DATE) return emptySpend(endDate);

  const token = await getAzureCredential().getToken(
    "https://management.azure.com/.default",
  );
  if (!token?.token) {
    throw new Error("Azure Cost Management authentication is unavailable.");
  }

  const scope = `/subscriptions/${encodeURIComponent(getAzureSubscriptionId())}/resourceGroups/${encodeURIComponent(getAzureResourceGroup())}`;
  const response = await queryCostManagement(
    `https://management.azure.com${scope}/providers/Microsoft.CostManagement/query?api-version=${COST_MANAGEMENT_API_VERSION}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "ActualCost",
        timeframe: "Custom",
        timePeriod: {
          from: `${COST_TRACKING_START_DATE}T00:00:00.000Z`,
          to: `${endDate}T00:00:00.000Z`,
        },
        dataset: {
          aggregation: {
            totalCost: { name: "PreTaxCost", function: "Sum" },
          },
          granularity: "None",
          grouping: [{ type: "Dimension", name: "ServiceName" }],
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Azure Cost Management returned HTTP ${response.status}.`);
  }

  const payload = AzureCostQueryResponseSchema.parse(await response.json());
  const columns = payload.properties?.columns ?? [];
  const rows = payload.properties?.rows ?? [];
  const costIndex = columns.findIndex((column) => column.name === "PreTaxCost");
  const serviceIndex = columns.findIndex(
    (column) => column.name === "ServiceName",
  );
  const currencyIndex = columns.findIndex(
    (column) => column.name === "Currency",
  );

  let totalCost = 0;
  let computeCost = 0;
  let currency = "USD";
  for (const row of rows) {
    const amount = Number(costIndex >= 0 ? (row[costIndex] ?? 0) : 0);
    if (!Number.isFinite(amount)) continue;
    totalCost += amount;

    const serviceName = String(
      serviceIndex >= 0 ? (row[serviceIndex] ?? "") : "",
    );
    if (isAzureComputeService(serviceName)) computeCost += amount;

    const rowCurrency = currencyIndex >= 0 ? row[currencyIndex] : null;
    if (typeof rowCurrency === "string" && /^[A-Z]{3}$/.test(rowCurrency)) {
      currency = rowCurrency;
    }
  }

  return {
    totalCost,
    computeCost,
    overheadCost: Math.max(0, totalCost - computeCost),
    currency,
    startDate: COST_TRACKING_START_DATE,
    endDate,
  };
}

/**
 * Azure Cost Management data is delayed and the admin page can be refreshed
 * repeatedly. Cache the result for an hour and keep the console available if
 * billing permissions or the API are temporarily unavailable.
 */
const getCachedCodevAzureSpend = unstable_cache(
  fetchCodevAzureSpend,
  ["codev-azure-spend-v1"],
  { revalidate: 3600 },
);

export async function getRealCodevAzureSpend(): Promise<CodevAzureSpend> {
  try {
    return await getCachedCodevAzureSpend();
  } catch (error) {
    console.warn("Azure spend unavailable; reporting zero.", error);
    return emptySpend(tomorrowIsoDate());
  }
}
