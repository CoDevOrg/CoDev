import "server-only";

import {
  CostExplorerClient,
  GetCostAndUsageCommand,
} from "@aws-sdk/client-cost-explorer";
import { unstable_cache } from "next/cache";

import { getAwsConfiguration } from "./aws";

// Cost Explorer is reachable only through its us-east-1 endpoint, regardless
// of which region the tagged resources actually run in.
const COST_EXPLORER_REGION = "us-east-1";

/**
 * The `Project=CoDev` cost allocation tag was activated in AWS Billing on
 * this date. Cost Explorer only reports tag-filtered spend from a tag's
 * activation date forward - it cannot retroactively reconstruct tagged
 * spend from before that, so this is the earliest date a real (not
 * estimated) number exists for.
 */
export const COST_TRACKING_START_DATE = "2026-09-05";

let client: CostExplorerClient | undefined;

function getClient() {
  const configuration = getAwsConfiguration();
  return (client ??= new CostExplorerClient({
    region: COST_EXPLORER_REGION,
    credentials: configuration.credentials,
  }));
}

export interface CodevAwsSpend {
  /** Real dollars AWS billed for every `Project=CoDev`-tagged resource. */
  totalUsd: number;
  /**
   * The slice of totalUsd that's EC2 compute - the only piece that can be
   * honestly split across workspaces, since the host is shared and every
   * workspace's sandbox/IDE session runs on the same instance.
   */
  ec2Usd: number;
  /**
   * Everything else tagged (KMS, S3, API Gateway, etc.) - real spend, but
   * shared platform plumbing with no honest way to attribute it to one
   * workspace over another.
   */
  overheadUsd: number;
  startDate: string;
  endDate: string;
}

const EC2_SERVICE_NAMES = new Set([
  "Amazon Elastic Compute Cloud - Compute",
  "EC2 - Other",
]);

async function fetchCodevAwsSpend(): Promise<CodevAwsSpend> {
  const endDate = new Date().toISOString().slice(0, 10);
  if (endDate <= COST_TRACKING_START_DATE) {
    return {
      totalUsd: 0,
      ec2Usd: 0,
      overheadUsd: 0,
      startDate: COST_TRACKING_START_DATE,
      endDate: COST_TRACKING_START_DATE,
    };
  }

  const response = await getClient().send(
    new GetCostAndUsageCommand({
      TimePeriod: { Start: COST_TRACKING_START_DATE, End: endDate },
      Granularity: "MONTHLY",
      Metrics: ["UnblendedCost"],
      Filter: { Tags: { Key: "Project", Values: ["CoDev"] } },
      GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
    }),
  );

  let totalUsd = 0;
  let ec2Usd = 0;
  for (const period of response.ResultsByTime ?? []) {
    for (const group of period.Groups ?? []) {
      const amount = Number(group.Metrics?.UnblendedCost?.Amount ?? "0");
      totalUsd += amount;
      if (EC2_SERVICE_NAMES.has(group.Keys?.[0] ?? "")) {
        ec2Usd += amount;
      }
    }
  }

  return {
    totalUsd,
    ec2Usd,
    overheadUsd: Math.max(0, totalUsd - ec2Usd),
    startDate: COST_TRACKING_START_DATE,
    endDate,
  };
}

/**
 * Cost Explorer bills $0.01 per API call, and the admin console can be
 * loaded repeatedly - cache the real result for an hour rather than paying
 * for a fresh query on every page view.
 */
export const getRealCodevAwsSpend = unstable_cache(
  fetchCodevAwsSpend,
  ["codev-aws-spend"],
  { revalidate: 3600 },
);
