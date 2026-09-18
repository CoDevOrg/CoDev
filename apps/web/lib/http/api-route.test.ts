import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  getApiUserAnyAuth: vi.fn(),
  requireWorkspacePermission: vi.fn(),
}));

vi.mock("@/lib/http/api", () => ({
  apiError: (error: unknown, status = 400) =>
    Response.json(
      { error: error instanceof Error ? error.message : "request failed" },
      { status },
    ),
  getApiUser: mocks.getApiUser,
  getApiUserAnyAuth: mocks.getApiUserAnyAuth,
}));
vi.mock("@/lib/auth/access", () => ({
  requireWorkspacePermission: mocks.requireWorkspacePermission,
}));

import {
  ApiError,
  errorStatus,
  readJson,
  withUser,
  withWorkspace,
} from "./api-route";

const user = { id: "2f2387ed-4a63-4b05-88cc-266d65f7b82b" };
const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";

function context<P>(params: P) {
  return { params: Promise.resolve(params) };
}

class StatusError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

describe("errorStatus", () => {
  it("uses a valid status carried by the error", () => {
    expect(errorStatus(new StatusError("gone", 404))).toBe(404);
    expect(errorStatus(new ApiError("conflict", 409))).toBe(409);
  });

  it("falls back for plain errors, non-errors and out-of-range statuses", () => {
    expect(errorStatus(new Error("nope"))).toBe(400);
    expect(errorStatus("nope", 502)).toBe(502);
    expect(errorStatus(new StatusError("ok?", 200), 500)).toBe(500);
    expect(errorStatus(new StatusError("nan", Number.NaN))).toBe(400);
  });
});

describe("readJson", () => {
  const schema = z.object({ name: z.string().min(1) });

  it("returns the parsed body", async () => {
    const request = new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ name: "codev" }),
    });
    await expect(readJson(request, schema)).resolves.toEqual({
      name: "codev",
    });
  });

  it("throws a 400 ApiError with the route's message for bad or missing JSON", async () => {
    const invalid = new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ name: "" }),
    });
    await expect(readJson(invalid, schema, "Bad name.")).rejects.toMatchObject({
      message: "Bad name.",
      status: 400,
    });
    const malformed = new Request("http://test", {
      method: "POST",
      body: "{",
    });
    await expect(readJson(malformed, schema)).rejects.toMatchObject({
      message: "Invalid request body.",
      status: 400,
    });
  });
});

describe("withUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApiUser.mockResolvedValue(user);
    mocks.getApiUserAnyAuth.mockResolvedValue(user);
  });

  it("returns 401 without calling the handler when signed out", async () => {
    mocks.getApiUser.mockResolvedValue(null);
    const handler = vi.fn();
    const response = await withUser(handler)(
      new Request("http://test"),
      context({}),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Authentication required.",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes the request, user and resolved params to the handler", async () => {
    const request = new Request("http://test");
    const handler = vi.fn(() => Response.json({ ok: true }));
    const response = await withUser<{ id: string }>(handler)(
      request,
      context({ id: "a" }),
    );
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith({
      request,
      user,
      params: { id: "a" },
    });
  });

  it("uses bearer-or-cookie auth only when asked", async () => {
    const handler = () => Response.json({});
    await withUser(handler)(new Request("http://test"), context({}));
    expect(mocks.getApiUserAnyAuth).not.toHaveBeenCalled();
    const request = new Request("http://test");
    await withUser(handler, { anyAuth: true })(request, context({}));
    expect(mocks.getApiUserAnyAuth).toHaveBeenCalledWith(request);
  });

  it("maps thrown errors to their own status, else the route fallback", async () => {
    const carried = await withUser(() => {
      throw new ApiError("Missing.", 404);
    })(new Request("http://test"), context({}));
    expect(carried.status).toBe(404);
    expect(await carried.json()).toEqual({ error: "Missing." });

    const plain = await withUser(
      () => {
        throw new Error("Runtime unreachable.");
      },
      { errorStatus: 502 },
    )(new Request("http://test"), context({}));
    expect(plain.status).toBe(502);
    expect(await plain.json()).toEqual({ error: "Runtime unreachable." });
  });
});

describe("withWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApiUser.mockResolvedValue(user);
  });

  it("checks the permission on the route's workspace before the handler", async () => {
    const access = { role: "owner" };
    mocks.requireWorkspacePermission.mockResolvedValue(access);
    const handler = vi.fn(() => Response.json({ ok: true }));
    const response = await withWorkspace("edit", handler)(
      new Request("http://test"),
      context({ workspaceId }),
    );
    expect(response.status).toBe(200);
    expect(mocks.requireWorkspacePermission).toHaveBeenCalledWith(
      workspaceId,
      user.id,
      "edit",
    );
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId, access, user }),
    );
  });

  it("returns the access error's status instead of a blanket 400", async () => {
    mocks.requireWorkspacePermission.mockRejectedValue(
      new StatusError("Workspace not found.", 404),
    );
    const handler = vi.fn();
    const response = await withWorkspace("view", handler)(
      new Request("http://test"),
      context({ workspaceId }),
    );
    expect(response.status).toBe(404);
    expect(handler).not.toHaveBeenCalled();

    mocks.requireWorkspacePermission.mockRejectedValue(
      new StatusError("No.", 403),
    );
    const forbidden = await withWorkspace("merge", handler)(
      new Request("http://test"),
      context({ workspaceId }),
    );
    expect(forbidden.status).toBe(403);
  });
});

describe("errorResponse via the wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApiUser.mockResolvedValue(user);
  });

  it("lets an error supply its whole response", async () => {
    class ConflictError extends Error {
      toResponse() {
        return Response.json(
          { error: this.message, conflictPaths: ["a.ts"] },
          { status: 409 },
        );
      }
    }
    const response = await withUser(() => {
      throw new ConflictError("Rebase conflict.");
    })(new Request("http://test"), context({}));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Rebase conflict.",
      conflictPaths: ["a.ts"],
    });
  });
});
