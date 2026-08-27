import type { Metadata } from "next";

import "../../mission-control.css";
import { DemoAgentsClient } from "./demo-agents-client";

export const metadata: Metadata = {
  title: "Mission Control · CoDev",
  description:
    "Every agent running in a CoDev workspace, who started it, what it is doing, and how to steer it.",
};

/**
 * A self-contained walkthrough of Mission Control with a simulated workspace.
 *
 * Real agents only exist while a runtime host is up and real subscriptions are
 * being spent, so the multi-human story cannot be shown on demand from live
 * data. This drives the same component the workspace uses from the same
 * snapshot shape — only the source is simulated.
 */
export default function DemoAgentsPage() {
  return <DemoAgentsClient />;
}
