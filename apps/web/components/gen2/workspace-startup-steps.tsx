"use client";

import { useEffect, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import type { Gen2RuntimeStatus } from "@codev/contracts";

import { cn } from "@/lib/platform/utils";

const STEPS: { status: Gen2RuntimeStatus; label: string }[] = [
  { status: "queued", label: "Waiting to start" },
  { status: "provisioning", label: "Preparing the machine" },
  { status: "booting", label: "Booting" },
  { status: "attaching_disk", label: "Attaching your saved files" },
  { status: "starting_tunnel", label: "Opening a secure connection" },
  { status: "checking_readiness", label: "Checking the connection" },
];

function elapsedLabel(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Where the machine is in startup. Without a known step it shows only elapsed time. */
export function WorkspaceStartupSteps({
  progress,
}: {
  progress: Gen2RuntimeStatus | null;
}) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, []);
  // "ready" means the machine is up and only the live check remains.
  const current = STEPS.findIndex(
    (step) =>
      step.status === (progress === "ready" ? "checking_readiness" : progress),
  );
  return (
    <div className="gen2-startup-steps">
      {current < 0 ? null : (
        <ol aria-label="Startup progress">
          {STEPS.map((step, index) => (
            <li
              key={step.status}
              aria-current={index === current ? "step" : undefined}
              className={cn(
                index < current && "is-done",
                index === current && "is-current",
              )}
            >
              {index < current ? (
                <Check aria-hidden="true" />
              ) : index === current ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <span className="gen2-startup-dot" aria-hidden="true" />
              )}
              {step.label}
            </li>
          ))}
        </ol>
      )}
      <p>{elapsedLabel(seconds)} · A cold start can take a few minutes.</p>
    </div>
  );
}
