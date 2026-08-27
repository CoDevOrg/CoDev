"use client";

import { useEffect, useState } from "react";

import { AgentMissionControl } from "@/components/agent-mission-control";
import {
  advanceDemo,
  createDemoSnapshot,
  interruptDemo,
  steerDemo,
} from "@/lib/mission-control-demo";
import type { MissionControlSnapshot } from "@/lib/mission-control-model";

/** How often the simulated workspace advances. Fast enough to feel alive on a
 *  projector, slow enough that a viewer can actually read a line. */
const TICK_MS = 1_400;

/** The member the demo is "signed in" as, so steers are attributed. */
const VIEWER_ID = "m-alex";

export function DemoAgentsClient() {
  // The seed is deterministic and every timestamp is relative to one `now`, so
  // the server and client first paint agree; only the tick below moves it, and
  // that runs in the browser.
  const [snapshot, setSnapshot] = useState<MissionControlSnapshot>(() =>
    createDemoSnapshot(),
  );

  useEffect(() => {
    const timer = setInterval(
      () => setSnapshot((current) => advanceDemo(current)),
      TICK_MS,
    );
    return () => clearInterval(timer);
  }, []);

  return (
    <AgentMissionControl
      snapshot={snapshot}
      viewerId={VIEWER_ID}
      onSteer={(agentId, text) =>
        setSnapshot((current) => steerDemo(current, agentId, VIEWER_ID, text))
      }
      onInterrupt={(agentId) =>
        setSnapshot((current) => interruptDemo(current, agentId, VIEWER_ID))
      }
    />
  );
}
