import { describe, expect, it } from "vitest";

import { OrchestratorError } from "./orchestrator";
import {
  classifyRuntimeFailure,
  RUNTIME_UNAVAILABLE_MESSAGE,
} from "./runtime-availability";

function named(name: string, message = "boom") {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe("classifyRuntimeFailure", () => {
  /**
   * The whole point: these are the errors an unconfigured checkout raises on
   * its first request, and reporting them as "starting" is what produced a
   * workspace that waited forever on a machine nobody was building.
   */
  it("names a missing Azure configuration variable", () => {
    expect(
      classifyRuntimeFailure(
        new Error("AZURE_SUBSCRIPTION_ID is not configured."),
      )?.detail,
    ).toMatch(/AZURE_SUBSCRIPTION_ID is not configured/);
    expect(
      classifyRuntimeFailure(
        new Error("AZURE_RESOURCE_GROUP is not configured."),
      )?.detail,
    ).toMatch(/AZURE_RESOURCE_GROUP/);
  });

  it("names a missing orchestrator endpoint, which is mandatory on Azure", () => {
    expect(
      classifyRuntimeFailure(
        new Error(
          "ORCHESTRATOR_DIRECT_URL/ORCHESTRATOR_DIRECT_SECRET are not configured.",
        ),
      )?.detail,
    ).toMatch(/ORCHESTRATOR_DIRECT_URL/);
  });

  it("treats a host that is not in the resource group as unavailable", () => {
    expect(
      classifyRuntimeFailure(
        new Error("The configured Firecracker host was not found."),
      ),
    ).toBeTruthy();
  });

  it("tells the developer to run az login when the credential chain is empty", () => {
    for (const name of [
      "CredentialUnavailableError",
      "AuthenticationError",
      "AggregateAuthenticationError",
      "AuthenticationRequiredError",
    ]) {
      expect(classifyRuntimeFailure(named(name))?.detail).toMatch(/az login/);
    }
  });

  it("treats an orchestrator authorization refusal as terminal", () => {
    expect(
      classifyRuntimeFailure(new OrchestratorError("nope", 403)),
    ).toBeTruthy();
    expect(
      classifyRuntimeFailure(new OrchestratorError("nope", 401)),
    ).toBeTruthy();
  });

  /**
   * Everything that resolves on its own must keep polling — a cold VM, a
   * capacity refusal, an orchestrator still booting, a dropped request.
   * Misclassifying one of these is worse than leaving an unknown fault to poll.
   */
  it("keeps genuinely transient failures on the polling path", () => {
    expect(
      classifyRuntimeFailure(new OrchestratorError("restarting", 503)),
    ).toBeNull();
    expect(
      classifyRuntimeFailure(new OrchestratorError("all slots busy", 409)),
    ).toBeNull();
    expect(classifyRuntimeFailure(new Error("socket hang up"))).toBeNull();
    expect(classifyRuntimeFailure(named("AbortError"))).toBeNull();
    expect(classifyRuntimeFailure(new Error("AllocationFailed"))).toBeNull();
  });

  /**
   * The regression guard for the leak: every classification must carry a
   * member-facing message that says nothing about how CoDev is wired. A new
   * branch that forgets to go through `unavailable()` fails here rather than
   * on staging.
   */
  it("never puts infrastructure detail in the member-facing message", () => {
    const failures = [
      new Error("AZURE_SUBSCRIPTION_ID is not configured."),
      new Error("AZURE_RESOURCE_GROUP is not configured."),
      new Error(
        "ORCHESTRATOR_DIRECT_URL/ORCHESTRATOR_DIRECT_SECRET are not configured.",
      ),
      new Error("The configured Firecracker host was not found."),
      named("CredentialUnavailableError"),
      new OrchestratorError("nope", 403),
    ];

    for (const failure of failures) {
      const classified = classifyRuntimeFailure(failure);
      expect(classified).not.toBeNull();
      expect(classified?.message).toBe(RUNTIME_UNAVAILABLE_MESSAGE);
      expect(classified?.message).not.toMatch(
        /az login|AZURE_|ORCHESTRATOR_|Firecracker|orchestrator|credential/i,
      );
    }
  });

  it("does not classify a non-error value", () => {
    expect(classifyRuntimeFailure("something")).toBeNull();
    expect(classifyRuntimeFailure(null)).toBeNull();
    expect(classifyRuntimeFailure(undefined)).toBeNull();
  });
});
