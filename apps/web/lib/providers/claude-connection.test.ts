import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../platform/observability", () => ({ logEvent: vi.fn() }));

import {
  ClaudeConnectionError,
  redactClaudeSecrets,
  toClaudeConnectionFailure,
  validateClaudeOAuthToken,
} from "./claude-connection";
import { logEvent } from "../platform/observability";
const logEventMock = vi.mocked(logEvent);

const TOKEN = "sk-ant-oat01-abc123XYZ_-4567890";

beforeEach(() => {
  logEventMock.mockReset();
});

describe("toClaudeConnectionFailure", () => {
  it("passes a ClaudeConnectionError through untouched and does not log", () => {
    const original = new ClaudeConnectionError("Start a new one.", 409);
    expect(toClaudeConnectionFailure(original, "evt")).toBe(original);
    expect(logEventMock).not.toHaveBeenCalled();
  });

  it("replaces a raw error with a generic message and logs the detail", () => {
    const raw = new Error(
      `Failed query: delete from "claude_connection_sessions" where "user_id" = $1 params: 464b50d7`,
    );
    const failure = toClaudeConnectionFailure(
      raw,
      "claude_connection.x_failed",
    );
    expect(failure).toBeInstanceOf(ClaudeConnectionError);
    expect(failure.status).toBe(500);
    expect(failure.message).not.toContain("claude_connection_sessions");
    expect(failure.message).not.toContain("delete from");
    expect(logEventMock).toHaveBeenCalledWith(
      "error",
      "claude_connection.x_failed",
      expect.objectContaining({
        detail: expect.stringContaining("Failed query"),
      }),
    );
  });

  it("redacts a Claude token from the logged detail", () => {
    toClaudeConnectionFailure(
      new Error(`runner crashed with ${TOKEN} in output`),
      "evt",
    );
    const context = logEventMock.mock.calls[0]?.[2] ?? {};
    expect(context.detail).not.toContain(TOKEN);
  });
});

describe("validateClaudeOAuthToken", () => {
  it("accepts a well-formed token and rejects junk", () => {
    expect(validateClaudeOAuthToken(TOKEN)).toBe(TOKEN);
    expect(() => validateClaudeOAuthToken("nope")).toThrow(/usable token/);
  });
});

describe("redactClaudeSecrets", () => {
  it("strips Claude tokens from free text but leaves the rest", () => {
    const out = redactClaudeSecrets(
      `login ok Token: ${TOKEN} exit 0\nsk-ant-api03-${"z".repeat(40)} also`,
    );
    expect(out).not.toContain(TOKEN);
    expect(out).not.toMatch(/sk-ant-[A-Za-z0-9_-]{12,}/);
    expect(out).toContain("login ok");
    expect(out).toContain("exit 0");
  });
});
